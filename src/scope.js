'use strict';

var _ = require('lodash');
var parse = require('./parse');

function $RootScopeProvider() {

	var TTL = 10;

	this.digestTtl = function(value) {
		if(_.isNumber(value)) {
			TTL = value;
		}
		return TTL;
	};

	this.$get = ['$parse', function($parse) {
		/* 初始化watcher.last */
		function initWatchVal() {}

		/* 为scope创建watchers的数组 */
		function Scope() {
			this.$$watchers = [];  // 监听器数组
			this.$$lastDirtyWatch = null; // 每次digest循环的最后一个脏的watcher, 用于优化digest循环
			this.$$asyncQueue = []; // scope上的异步队列
			this.$$applyAsyncQueue = []; // scope上的异步apply队列
			this.$$applyAsyncId = null;  //异步apply信息
			this.$$postDigestQueue = []; // postDigest执行队列
			this.$$phase = null; // 储存scope上正在做什么,值有：digest/apply/null
			this.$root = this; // rootScope

			this.$$listeners = {}; // 存储包含自定义事件键值对的对象

			this.$$children = []; // 存储当前scope的儿子Scope,以便$digest循环递归
		}

		/* $watch方法：向watchers数组中添加watcher对象，以便对应调用 */
		Scope.prototype.$watch = function(watchFn, listenerFn, valueEq) {
			var self = this;

			watchFn = $parse(watchFn);

			// watchDelegate: 针对watch expression是常量和 one-time-binding的情况，进行优化。在第一次初始化之后删除watch
			if(watchFn.$$watchDelegate) {
				return watchFn.$$watchDelegate(self, listenerFn, valueEq, watchFn);
			}

			var watcher = {
				watchFn: watchFn,
				listenerFn: listenerFn || function() {},
				valueEq: !!valueEq,
				last: initWatchVal
			};

			this.$$watchers.unshift(watcher);
			this.$root.$$lastDirtyWatch = null;

			return function() {
				var index = self.$$watchers.indexOf(watcher);
				if(index >= 0) {
					self.$$watchers.splice(index, 1);
					self.$root.$$lastDirtyWatch = null;
				}
			};
		};

		/* $watchGroup方法，基于$watch 监听一个数组里的多个值 */
		Scope.prototype.$watchGroup = function(watchFns, listenerFn) {
			var self = this;
			var newValues = new Array(watchFns.length);
			var oldValues = new Array(watchFns.length);
			var changeReactionScheduled = false;
			var firstRun = true;

			if(watchFns.length === 0) {
				var shouldCall = true;

				self.$evalAsync(function() {
					if(shouldCall) {
						listenerFn(newValues, newValues, self);
					}
				});
				return function() {
					shouldCall = false;
				};
			}

			function watchGroupListener() {
				if(firstRun) {
					firstRun = false;
					listenerFn(newValues, newValues, self);
				} else {
					listenerFn(newValues, oldValues, self);
				}
				changeReactionScheduled = false;
			}
			
			var destroyFunctions = _.map(watchFns, function(watchFn, i) {
				return self.$watch(watchFn, function(newValue, oldValue) {
					newValues[i] = newValue;
					oldValues[i] = oldValue;

					if(!changeReactionScheduled) {
						changeReactionScheduled = true;
						self.$evalAsync(watchGroupListener);
					}
				});
			});

			return function() {
				_.forEach(destroyFunctions, function(destroyFunction) {
					destroyFunction();
				});
			};
		};

		/* $watchCollection 代码比较杂乱，都是些分类处理代码
			这个方法主要在 watch 大型数组，对象时，能够提高效率，
			针对数据size进行的判断，减少了循环。效率远高于$watch的deep watch.
			这个方法貌似被叫做 shallow collection-watching.
		 */
		Scope.prototype.$watchCollection = function(watchFn, listenerFn) {
			var self = this;
			var newValue;
			var oldValue;
			var oldLength;
			var veryOldValue;
			var trackVeryOldValue = (listenerFn.length > 1);
			var changeCount = 0;
			var firstRun = true;

			watchFn = $parse(watchFn);

			function isArrayLike(obj) {
				if(_.isNull(obj) || _.isUndefined(obj)) {
					return false;
				}
				var length = obj.length;
				return length === 0 || (_.isNumber(length) && length > 0 && (length - 1) in obj);
			}

			var internalWatchFn = function(scope) {
				var newLength;
				newValue = watchFn(scope);

				if(_.isObject(newValue)) {
					if(isArrayLike(newValue)) {
						if(!_.isArray(oldValue)) {
							changeCount++;
							oldValue = [];
						}
						if(newValue.length !== oldValue.length) {
							changeCount++;
							oldValue.length = newValue.length;
						}
						_.forEach(newValue, function(newItem, i) {
							var bothNaN = _.isNaN(newItem) && _.isNaN(oldValue[i]);

							if(!bothNaN && newItem !== oldValue[i]) {
								changeCount++;
								oldValue[i] = newItem;
							}
						});
					} else {
						if(!_.isObject(oldValue) || isArrayLike(oldValue)) {
							changeCount++;
							oldValue = {};
							oldLength = 0;
						}
						newLength = 0;

						_.forOwn(newValue, function(newVal, key) {
							newLength++;

							if(oldValue.hasOwnProperty(key)) {
								var bothNaN = _.isNaN(newVal) && _.isNaN(oldValue[key]);
								if(!bothNaN && oldValue[key] !== newVal) {
									changeCount++;
									oldValue[key] = newVal;
								}
							} else {
								changeCount++;
								oldLength++;
								oldValue[key] = newVal;
							}
						});

						if(oldLength > newLength) {
							changeCount++;
							_.forOwn(oldValue, function(oldVal, key) {
								if(!newValue.hasOwnProperty(key)) {
									oldLength--;
									delete oldValue[key];
								}
							});
						}
					}
				} else {
					if(!self.$$areEqual(newValue, oldValue, false)) {
						changeCount++;
					}
					oldValue = newValue;
				}

				return changeCount;
			};

			var internalListenerFn = function() {
				if(firstRun) {
					listenerFn(newValue, newValue, self);
					firstRun = false;
				} else {
					listenerFn(newValue, veryOldValue, self);
				}

				if (trackVeryOldValue) {
					veryOldValue = _.clone(newValue);
				}
			};

			return this.$watch(internalWatchFn, internalListenerFn);
		};

		/* $digestOnce方法: 遍历scope的watchers数组，并调用对应listener函数 */
		Scope.prototype.$$digestOnce = function() {
			var dirty;
			var continueLoop =  true;
			var self = this;

			this.$$everyScope(function(scope) {
				var newValue, oldValue;

				_.forEachRight(scope.$$watchers, function(watcher) {
					try {
						if(watcher) {
							newValue = watcher.watchFn(scope);
							oldValue = watcher.last;

							if(!scope.$$areEqual(newValue, oldValue, watcher.valueEq)) {
								scope.$root.$$lastDirtyWatch = watcher;

								watcher.last = (watcher.valueEq ? _.cloneDeep(newValue) : newValue);
								
								watcher.listenerFn(newValue,
									(oldValue === initWatchVal? newValue : oldValue), scope);
								dirty = true;
							} else if(scope.$root.$$lastDirtyWatch === watcher) {
								continueLoop = false;
								return false;
							}
						}
					} catch(e) {
						console.error(e);
					}
				});
				return continueLoop;
			});

			return dirty;
		};

		// digest循环的外循环，保持循环直到没有脏值为止
		Scope.prototype.$digest = function() {
			var ttl = TTL;
			var dirty;
			this.$root.$$lastDirtyWatch = null;

			this.$beginPhase('$digest');

			if(this.$root.$$applyAsyncId) {
				clearTimeout(this.$root.$$applyAsyncId);
				this.$$flushApplyAsync();
			}

			do {
				while (this.$$asyncQueue.length) {
					try {
						var asyncTask = this.$$asyncQueue.shift();
						asyncTask.scope.$eval(asyncTask.expression);
					} catch(e) {
						console.error(e);
					}
				}

				dirty = this.$$digestOnce();

				if((dirty || this.$$asyncQueue.length) && !(ttl--)) {
					this.$clearPhase();
					throw TTL + ' digest iterations reached';
				}
			} while (dirty || this.$$asyncQueue.length);
			this.$clearPhase();

			while(this.$$postDigestQueue.length) {
				try {
					this.$$postDigestQueue.shift()();
				} catch(e) {
					console.error(e);
				}
			}
		};

		Scope.prototype.$$areEqual = function(newValue, oldValue, valueEq) {
			if(valueEq) {
				return _.isEqual(newValue, oldValue);
			} else {
				return newValue === oldValue ||
				(typeof newValue === 'number' && typeof oldValue ==='number' && isNaN(newValue) && isNaN(oldValue));
			}
		};

		/* scope上的方法实现 */
		Scope.prototype.$eval = function(expr, locals) {
			return $parse(expr)(this, locals);
		};

		Scope.prototype.$apply = function(expr) {
			try {
				this.$beginPhase('$apply');
				return this.$eval(expr);
			} finally {
				this.$clearPhase();
				this.$root.$digest();
			}
		};

		Scope.prototype.$evalAsync = function(expr) {
			var self = this;
			if(!self.$$phase && !self.$$asyncQueue.length) {
				setTimeout(function() {
					if(self.$$asyncQueue.length) {
						self.$root.$digest();
					}
				}, 0);
			}

			this.$$asyncQueue.push({
				scope: this,
				expression: expr
			});
		};

		/* 这个方法用于 知道需要在短时间内多次使用$apply的情况，
		   能够对短时间内多次$digest循环进行合并，
		   是针对$digest循环的优化策略
		 */
		Scope.prototype.$applyAsync = function(expr) {
			var self = this;
			self.$$applyAsyncQueue.push(function() {
				self.$eval(expr);
			});

			if(self.$root.$$applyAsyncId === null) {
				self.$root.$$applyAsyncId = setTimeout(function() {
					self.$apply(_.bind(self.$$flushApplyAsync, self));
				}, 0);
			}
		};

		/* $$postDigest 用于在下一次digest循环后执行函数队列 
		 不同于applyAsync 和 evalAsync, 它不触发digest循环
		 */
		Scope.prototype.$$postDigest =  function(fn) {
			this.$$postDigestQueue.push(fn);
		};

		/* 设置scope的$$phase属性 标示scope所处的阶段 */
		Scope.prototype.$beginPhase = function(phase) {
			if(this.$$phase) {
				throw this.$$phase + 'already in progress.';
			}
			this.$$phase = phase;
		};

		Scope.prototype.$clearPhase = function() {
			this.$$phase = null;
		};

		/* 在$applyAsync中使用的工具方法 */
		Scope.prototype.$$flushApplyAsync = function() {
			while(this.$$applyAsyncQueue.length) {
				try {
					this.$$applyAsyncQueue.shift()();
				} catch(e) {
					console.error(e);
				}
			}
			this.$root.$$applyAsyncId = null;
		};
		/* Scope原型继承部分的方法 */
		Scope.prototype.$new = function(isolated, parent) {
			var child;
			parent = parent || this;

			if(isolated) {
				child = new Scope();
				child.$root = parent.$root;
				child.$$asyncQueue = parent.$$asyncQueue;
				child.$$postDigestQueue = parent.$$postDigestQueue;
				child.$$applyAsyncQueue = parent.$$applyAsyncQueue;
			} else {
				var ChildScope = function() {};
				ChildScope.prototype = this;
				child = new ChildScope();
			}
			
			parent.$$children.push(child);

			child.$$watchers = []; // shadow这个prop,使成为每个scope独立拥有这个prop
			child.$$listeners = {}; // shadow这个prop, 存储包含自定义事件键值对的对象 
			child.$$children = []; // shadow这个prop,使成为每个scope独立拥有这个prop
			child.$parent = parent; // 缓存parentScope, 以便让scope上的其他method能够使用它，比如$destroy

			return child;
		};

		/* scope的销毁方法，依赖 $broadcast 通知children */
		Scope.prototype.$destroy = function() {
			this.$broadcast('$destroy');
			if(this.$parent) {
				var siblings = this.$parent.$$children;
				var indexOfThis = siblings.indexOf(this);
				if(indexOfThis >= 0) {
					siblings.splice(indexOfThis, 1);
				}
			}

			this.$$watchers = null;
			this.$$listeners = {};
		};

		/* 为使$digest循环能够递归child scope上的watchers的工具方法 
		   这个方法还用于实现$broadcast
		*/
		Scope.prototype.$$everyScope = function(fn) {
			if(fn(this)) {
				return this.$$children.every(function(child) {
					return child.$$everyScope(fn);
				});
			} else {
				return false;
			}
		};

		/*
		 angularjs event system: publish-subscribe 发布者/订阅者 模式
		*/
		Scope.prototype.$on = function(eventName, listener) {
			var listeners = this.$$listeners[eventName];

			if(!listeners) {
				this.$$listeners[eventName] = listeners = [];
			}

			listeners.push(listener);

			return function(eventName) {
				var index = listeners.indexOf(listener);
				
				if(index >= 0) {
					listeners[index] = null;
				}
			};
		};

		/* propagating up */
		Scope.prototype.$emit = function(eventName) {
			var propagationStopped = false;
			var event = {
				name: eventName,
				targetScope: this,
				stopPropagation: function() {
					propagationStopped = true;
				},
				preventDefault: function() {
					event.defaultPrevented = true;
				}
			};

			//  把event和additionalArgs拼接成新数组，通过apply方法传入listener, 使参数获取方式正常
			var listenerArgs = [event].concat(_.tail(arguments));
			var scope = this;

			do {
				event.currentScope = scope;
				scope.$$fireEventOnScope(eventName, listenerArgs);
				scope = scope.$parent;  // 通过改变scope引用 实现向上传播的关键代码
			} while (scope && !propagationStopped);

			event.currentScope = null;

			return event;
		};

		/* propagating down */
		Scope.prototype.$broadcast = function(eventName) {
			var event = {
				name: eventName,
				targetScope: this,
				preventDefault: function() {
					event.defaultPrevented = true;
				}
			};

			//  把event和additionalArgs拼接成新数组，通过apply方法传入listener, 使参数获取方式正常
			var listenerArgs = [event].concat(_.tail(arguments));

			this.$$everyScope(function(scope) {
				event.currentScope = scope;
				scope.$$fireEventOnScope(eventName, listenerArgs);
				return true;
			});

			event.currentScope = null;

			return event;
		};

		/*  $emit 和 $broadcast中 提取出的 fire event listener函数
			angularjs源码没有这个方法，其中只是重复了这些代码, 本书作者提出了重复代码
		 */
		Scope.prototype.$$fireEventOnScope = function(eventName, listenerArgs) {

			var listeners = this.$$listeners[eventName] || [];
			var i = 0;

			while(i < listeners.length) {
				if(listeners[i] === null) {
					listeners.splice(i, 1);
				} else {
					try {
						listeners[i].apply(null, listenerArgs);
					} catch(e) {
						console.error(e);
					}
					i++;
				}
			}

			return event;
		};

		var $rootScope = new Scope();
		return $rootScope;
	}];
}

module.exports = $RootScopeProvider;
