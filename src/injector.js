'use strict';

var _ = require('lodash');
var HashMap = require('./hash_map').HashMap;

// 这个正则能去除函数的参数部分 但参数之前的whitespace被保留了
var FN_ARGS = /^function\s*[^\(]*\(\s*([^\)]*)\)/m;

// 这个正则去掉参数前面的空格
var FN_ARG = /^\s*(_?)(\S+?)\1\s*$/;

// 丢掉注释 的正则
var STRIP_COMMENTS = /(\/\/.*$)|(\/\*.*?\*\/)/mg;

var INSTANTIATING = {};


function createInjector(modulesToLoad, strictDi) {
	var providerCache = {};
	var providerInjector = providerCache.$injector = createInternalInjector(providerCache, function() {
		throw 'Unknown provider: ' + path.join(' <- ');
	});

	var instanceCache = {};
	var instanceInjector = instanceCache.$injector = createInternalInjector(instanceCache, function(name) {
		var provider = providerInjector.get(name + 'Provider');
		return instanceInjector.invoke(provider.$get, provider);
	});

	var loadedModules = new HashMap();
	var path = [];

	strictDi = (strictDi === true);

	// 确认factoryFn存在返回值 的工具方法，用于$provider.factory
	function enforceReturnValue(factoryFn) {
		return function() {
			var value = instanceInjector.invoke(factoryFn);
			if(_.isUndefined(value)) {
				throw 'factory must return a value';
			}
			return value;
		}
	}

	providerCache.$provide = {
		constant: function(key, value) {
			if(key === 'hasOwnProperty') {
				throw 'hasOwnProperty is not a valid constant name!';
			}
			
			providerCache[key] = value;
			instanceCache[key] = value;
		},
		provider: function(key, provider) {
			if(_.isFunction(provider)) {
				provider = providerInjector.instantiate(provider);
			}

			providerCache[key + 'Provider'] = provider;
		},
		factory: function(key, factoryFn, enforce) {
			this.provider(key, {
				$get: enforce === false? factoryFn : enforceReturnValue(factoryFn)
			});
		},
		value: function(key, value) {
			this.factory(key, _.constant(value), false);
		},
		service: function(key, Constructor) {
			this.factory(key, function() {
				return instanceInjector.instantiate(Constructor);
			});
		},
		decorator: function(serviceName, decoratorFn) {
			var provider = providerInjector.get(serviceName + 'Provider');
			var original$get = provider.$get;

			provider.$get = function() {
				var instance = instanceInjector.invoke(original$get, provider);
				// 装饰器在这里起作用
				instanceInjector.invoke(decoratorFn, null, {$delegate: instance});
				
				return instance;
			}
		}
	};

	// 这个函数中的3种处理分别对应了 angular中依赖注入的3种注释形式
	// 分别是 ['x', 'x', fn], $inject = [], 隐式注入 
	// 作用： 剥离出 依赖的module name数组
	function annotate(fn) {
		if(_.isArray(fn)) {
			return fn.slice(0, fn.length -1);
		} else if(fn.$inject) {
			return fn.$inject;
		} else if(!fn.length) {
			return [];
		} else {
			if(strictDi) {
				throw 'fn is not using explicit annotation and '+
					'cannot be invoked in strict mode';
			}

			var source = fn.toString().replace(STRIP_COMMENTS, '');
			var argDeclaration = source.match(FN_ARGS);

			return _.map(argDeclaration[1].split(','), function(argName) {
				return argName.match(FN_ARG)[2];
			});
		}
	}

	// 分类create injector，区分开provider injector和 instance injector
	// 返回injector对象
	function createInternalInjector(cache, factoryFn) {

		function getService(name) {
			if(cache.hasOwnProperty(name)) {
				// 检测是否存在环形依赖, 即 A依赖B B依赖C C依赖A
				if(cache[name] === INSTANTIATING) {
					throw new Error('Circular dependency found: ' +
						name + ' <- ' + path.join(' <- '));
				}

				return cache[name];

			} else {
				path.unshift(name);
				cache[name] = INSTANTIATING;

				try {
					return (cache[name] = factoryFn(name));
				} finally {
					path.shift();
					if(cache[name] === INSTANTIATING) {
						delete cache[name];
					}
				}
			}
		}

		function invoke(fn, self, locals) {
			// dependency lookup loop
			var args = _.map(annotate(fn), function(token) {
				if(_.isString(token)) {
					return locals && locals.hasOwnProperty(token) ? locals[token] : getService(token);
				} else {
					throw 'Incorrect injection token! Expected a string, got ' + token;
				}
			});

			if(_.isArray(fn)) {
				fn = _.last(fn);
			}

			return fn.apply(self, args);
		}

		function instantiate(Type, locals) {
		// var UnwrappedType = _.isArray(Type) ? _.last(Type) : Type;
			var UnwrappedType = _.isArray(Type)? _.last(Type) : Type;
			var instance = Object.create(UnwrappedType.prototype);
			invoke(Type, instance, locals);
			return instance;
		}

		return {
			has: function(key) {
				return cache.hasOwnProperty(key) ||
					providerCache.hasOwnProperty(key + 'Provider');
			},
			get: getService,
			annotate: annotate,
			invoke: invoke,
			instantiate: instantiate
		};

	}

	function runInvokeQueue(queue) {
		_.forEach(queue, function(invokeArgs) {

			var service = providerInjector.get(invokeArgs[0]);
			var method = invokeArgs[1];
			var args = invokeArgs[2];

			service[method].apply(service, args);
		});
	}

	// injector核心代码
	var runBlocks = [];

	// 这个for循环进行 dependencies loading, 依赖加载
	_.forEach(modulesToLoad, function loadModule(module) {
		if(!loadedModules.get(module)) {
			loadedModules.put(module, true);

			if(_.isString(module)) {
				module = window.angular.module(module);
				_.forEach(module.requires, loadModule);

				// 循环执行 module._invokeQueue 和 module.configBlocks 中的任务
				runInvokeQueue(module._invokeQueue);
				runInvokeQueue(module._configBlocks);

				runBlocks = runBlocks.concat(module._runBlocks);

			} else if(_.isFunction(module) || _.isArray(module)) {
				// 允许以function的形式向module中注入module
				runBlocks.push(providerInjector.invoke(module));
			}
		}

	});

	// 通过instanceInjector 循环执行 runBlocks中的函数
	// runBlocks中的函数执行位置在 依赖modules被加载完成之后
	_.forEach(_.compact(runBlocks), function(runBlock) {
		instanceInjector.invoke(runBlock);
	});

	return instanceInjector;
}




module.exports = createInjector;
