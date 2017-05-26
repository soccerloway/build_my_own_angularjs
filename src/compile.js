'use strict';

var PREFIX_REGEXP = /(x[\:\-_]|data[\:\-_])/i;

var BOOLEAN_ATTRS = {
	multiple: true,
	selected: true,
	checked: true,
	disabled: true,
	readOnly: true,
	required: true,
	open: true
};

var BOOLEAN_ELEMENTS = {
	INPUT: true,
	SELECT: true,
	OPTION: true,
	TEXTAREA: true,
	BUTTON: true,
	FORM: true,
	DETAILS: true
};

// 匹配require的前缀
var REQUIRE_PREFIX_REGEXP = /^(\^\^?)?(\?)?(\^\^?)?/;

var _ = require('lodash');
var $ = require('jquery');

// 返回nodename，无论是普通node还是jq包装过的node
function nodeName(element) {
	return element.nodeName ? element.nodeName : element[0].nodeName;
}

function directiveNormalize(name) {
	return _.camelCase(name.replace(PREFIX_REGEXP, ''));
}

// 判断是否是标准html boolean属性，且是使用这些属性的元素
function isBooleanAttribute(node, attrName) {
	return BOOLEAN_ATTRS[attrName] && BOOLEAN_ELEMENTS[node.nodeName];
}

// 为attributes bindings做准备
// 接受scope definition object, 返回parsed binding rules object
function parseIsolateBindings(scope) {
	var bindings = {};
	_.forEach(scope, function(definition, scopeName) {
		var match = definition.match(/\s*([@<&]|=(\*?))(\??)\s*(\w*)\s*/);

		bindings[scopeName] = {
			mode: match[1][0],
			collection: match[2] === '*',
			optional: match[3],
			attrName: match[4] || scopeName
		};
	});

	return bindings;
}

function parseDirectiveBindings(directive) {
	var bindings = {};
	if(_.isObject(directive.scope)) {
		if(directive.bindToController) {
			bindings.bindToController = parseIsolateBindings(directive.scope);
		} else {
			bindings.isolateScope = parseIsolateBindings(directive.scope);
		}
	}

	if(_.isObject(directive.bindToController)) {
		bindings.bindToController = parseIsolateBindings(directive.bindToController);
	}

	return bindings;
}

// 构造 合法的 require objects
function getDirectiveRequire(directive, name) {
	var require = directive.require || (directive.controller && name);
	
	if (!_.isArray(require) && _.isObject(require)) {
		_.forEach(require, function(value, key) {
			var prefix = value.match(REQUIRE_PREFIX_REGEXP);
			var name = value.substring(prefix[0].length);

			if (!name) {
				require[key] = prefix[0] + key;
			}
		}); 
	}
	return require;
}



function $CompileProvider($provide) {

	var hasDirectives = {};

	this.directive = function(name, directiveFactory) {
		if(_.isString(name)) {
			if(name === 'hasOwnProperty') {
				throw 'hasOwnProperty is not a valid directive name';
			}

			if(!hasDirectives.hasOwnProperty(name)) {
				hasDirectives[name] = [];

				$provide.factory(name + 'Directive', ['$injector', function($injector) {
					var factories = hasDirectives[name];
					return _.map(factories, function(factory, i) {
						var directive = $injector.invoke(factory);
						directive.restrict = directive.restrict || 'EA';
						directive.priority = directive.priority || 0;

						// 当directive defined object中只存在link，不存在compile时
						// 就把link当成compile使用
						if(directive.link && !directive.compile) {
							directive.compile = _.constant(directive.link);
						}
						// 处理attributes bindings: parseIsolateBindings
						directive.$$bindings = parseDirectiveBindings(directive);
						directive.name = directive.name || name;
						directive.require = getDirectiveRequire(directive, name);
						directive.index = i;
						return directive;
					});
				}]);
			}

			hasDirectives[name].push(directiveFactory);
		} else {
			_.forEach(name, _.bind(function(directiveFactory, name) {
				this.directive(name, directiveFactory);
			}, this));
		}

	};


	this.$get = ['$injector', '$parse', '$controller', '$rootScope', '$http', function($injector, $parse, $controller, $rootScope, $http) {

		// 构造指令的attrs对象，同一个dom，不同指令会共享这一个attrs对象
		function Attributes(element) {
			this.$$element = element;
			this.$attr = {};
		}

		Attributes.prototype.$set = function(key, value, writeAttr, attrName) {
			this[key] = value;

			if(isBooleanAttribute(this.$$element[0], key)) {
				this.$$element.prop(key, value);
			}

			if(!attrName) {
				if(this.$attr[key]) {
					attrName = this.$attr[key];
				} else {
					attrName = this.$attr[key] = _.kebabCase(key, '-');
				}

			} else {
				this.$attr[key] = attrName;
			}

			if(writeAttr !== false) {
				this.$$element.attr(attrName, value);
			}

			// $set触发$$observers执行
			if(this.$$observers) {
				_.forEach(this.$$observers[key], function(observer) {
					try {
						observer(value);
					} catch(e) {
						console.log(e);
					}
				});
			}
		};

		Attributes.prototype.$observe = function(key, fn) {
			var self = this;
			this.$$observers = this.$$observers || Object.create(null);
			this.$$observers[key] = this.$$observers[key] || [];
			this.$$observers[key].push(fn);

			$rootScope.$evalAsync(function() {
				fn(self[key]);
			});

			// 和watch，event一样，返回一个remove函数
			return function() {
				var index = self.$$observers[key].indexOf(fn);
				if(index >= 0) {
					self.$$observers[key].splice(index, 1);
				}
			};
		};

		Attributes.prototype.$addClass = function(classVal) {
			this.$$element.addClass(classVal);
		};

		Attributes.prototype.$removeClass = function(classVal) {
			this.$$element.removeClass(classVal);
		};

		Attributes.prototype.$updateClass = function(newClassVal, oldClassVal) {
			var newClasses = newClassVal.split(/\s+/);
			var oldClasses = oldClassVal.split(/\s+/);
			var addedClasses = _.difference(newClasses, oldClasses);
			var removedClasses = _.difference(oldClasses, newClasses);

			if(addedClasses.length) {
				this.$addClass(addedClasses.join(' '));
			}

			if(removedClasses.length) {
				this.$removeClass(removedClasses.join(' '));
			}
		};

		/* -----分割线：上面是attrs对象的创建，下面是directive compile过程----- */
		
		// $compile的功能就是compile dom tree, 再返回这个公共的linking function
		function compile($compileNodes) {
			var compositeLinkFn = compileNodes($compileNodes);

			// publicLinkFn link整个compile出的dom树
			return function publicLinkFn(scope) {
				$compileNodes.data('$scope', scope);
				compositeLinkFn(scope, $compileNodes);
			};
		}

		// compile节点，收集nodeLinkFn, 返回compositeLinkFn
		function compileNodes($compileNodes) {
			var linkFns = [];

			_.forEach($compileNodes, function(node, i) {
				var attrs = new Attributes($(node));
				var directives = collectDirectives(node, attrs);
				var nodeLinkFn;
				if(directives.length) {
					nodeLinkFn = applyDirectivesToNode(directives, node, attrs);
				}

				var childLinkFn;
				if((!nodeLinkFn || !nodeLinkFn.terminal) && node.childNodes && node.childNodes.length) {
					childLinkFn = compileNodes(node.childNodes);
				}

				if(nodeLinkFn && nodeLinkFn.scope) {
					attrs.$$element.addClass('ng-scope');
				}

				if(nodeLinkFn || childLinkFn) {
					linkFns.push({
						nodeLinkFn: nodeLinkFn,
						childLinkFn: childLinkFn,
						idx: i
					});
				}
			});

			// compositeLinkFn link节点集合 执行了所有的linkFn
			function compositeLinkFn(scope, linkNodes) {
				var stableNodeList = [];
				_.forEach(linkFns, function(linkFn) {
					var nodeIdx = linkFn.idx;
					stableNodeList[nodeIdx] = linkNodes[nodeIdx];
				});


				_.forEach(linkFns, function(linkFn) {
					var node = stableNodeList[linkFn.idx];

					if(linkFn.nodeLinkFn) {
						if(linkFn.nodeLinkFn.scope) {
							scope = scope.$new();
							$(node).data('$scope', scope);
						}

						linkFn.nodeLinkFn(
							linkFn.childLinkFn,
							scope,
							node
						);
					} else {
						linkFn.childLinkFn(
							scope,
							node.childNodes
						);
					}
				});
			}

			return compositeLinkFn;
		}

		// 收集dom上应用的指令并返回,指令执行顺序根据 优先级，指令名称， 注册顺序 确定
		function collectDirectives(node, attrs) {
			var directives = [];
			var match;

			if(node.nodeType === node.ELEMENT_NODE) {
				var normalizedNodeName = directiveNormalize(nodeName(node).toLowerCase());
				addDirective(directives, normalizedNodeName, 'E');

				// 寻找attr方式的指令使用
				_.forEach(node.attributes, function(attr) {
					var attrStartName, attrEndName;
					var name = attr.name;
					var normalizedAttrName = directiveNormalize(name.toLowerCase());
					var isNgAttr = /^ngAttr[A-Z]/.test(normalizedAttrName);

					if(isNgAttr) {
						name = _.kebabCase(
							normalizedAttrName[6].toLowerCase() +
							normalizedAttrName.substring(7)
						);
						normalizedAttrName = directiveNormalize(name.toLowerCase());
					}
					attrs.$attr[normalizedAttrName] = name;

					// 处理multiElement为true的指令
					var directiveNName = normalizedAttrName.replace(/(Start|End)$/, '');
					if(directiveIsMultiElement(directiveNName)) {
						if(/Start$/.test(normalizedAttrName)) {
							attrStartName = name;
							attrEndName = name.substring(0, name.length - 5) + 'End';
							name = name.substring(0, name.length - 6);
						}
					}

					normalizedAttrName = directiveNormalize(name.toLowerCase());
					addDirective(directives, normalizedAttrName, 'A', attrStartName, attrEndName);
					
					if(isNgAttr || !attrs.hasOwnProperty(normalizedAttrName)) {
						attrs[normalizedAttrName] = attr.value.trim();
						
						// 把标准html相关的属性设为true
						if(isBooleanAttribute(node, normalizedAttrName)) {
							attrs[normalizedAttrName] = true;
						}
					}
				});

				// 寻找class方式的指令使用
				var className = node.className;
				if(_.isString(className) && !_.isEmpty(className)) {
					while ((match = /([\d\w\-_]+)(?:\:([^;]+))?;?/.exec(className))) {
  						var normalizedClassName = directiveNormalize(match[1]);
						if (addDirective(directives, normalizedClassName, 'C')) {
							attrs[normalizedClassName] = match[2] ? match[2].trim() : undefined;
						}

  						className = className.substr(match.index + match[0].length);
					}
				}

			} else if(node.nodeType === Node.COMMENT_NODE) {
				match = /^\s*directive\:\s*([\d\w\-_]+)\s*(.*)$/.exec(node.nodeValue);
				if (match) {
					var normalizedName = directiveNormalize(match[1]);
					if (addDirective(directives, normalizedName, 'M')) {
						attrs[normalizedName] = match[2] ? match[2].trim() : undefined;
					}
				}
			}
			
			directives.sort(byPriority);

			return directives;
		}

		function directiveIsMultiElement(name) {
			if(hasDirectives.hasOwnProperty(name)) {
				var directives = $injector.get(name + 'Directive');
				return _.some(directives, {multiElement: true});
			}
			return false;
		}

		function addDirective(directives, name, mode, attrStartName, attrEndName) {
			var match;	
			if(hasDirectives.hasOwnProperty(name)) {
				var foundDirectives = $injector.get(name + 'Directive');
				var applicableDirectives = _.filter(foundDirectives, function(dir) {
					return dir.restrict.indexOf(mode) !== -1;
				});

				_.forEach(applicableDirectives, function(directive) {
					if(attrStartName) {
						directive = _.create(directive, {
							$$start: attrStartName,
							$$end: attrEndName
						});
					}
					directives.push(directive);
					match = directive;
				});
			}

			return match;
		}

		// 通过templateUrl 异步获取tempalte，并恢复compilation
		// denpend on: $http
		function compileTemplateUrl(directives, $compileNode, attrs, previousCompileContext) {
			var origAsyncDirective = directives.shift();
			var derivedSynDirective = _.extend(
				{},
				origAsyncDirective,
				{templateUrl: null}
			);

			var templateUrl = _.isFunction(origAsyncDirective.templateUrl) ?
				origAsyncDirective.templateUrl($compileNode, attrs) :
				origAsyncDirective.templateUrl;

			var afterTemplateNodeLinkFn, afterTemplateChildLinkFn;
			var linkQueue = [];

			$compileNode.empty();
			$http.get(templateUrl).success(function(template) {
				directives.unshift(derivedSynDirective);
				$compileNode.html(template);
				afterTemplateNodeLinkFn = applyDirectivesToNode(directives, $compileNode, attrs, previousCompileContext);
				afterTemplateChildLinkFn = compileNodes($compileNode[0].childNodes);

				_.forEach(linkQueue, function(linkCall) {
					afterTemplateNodeLinkFn(
						afterTemplateChildLinkFn,
						linkCall.scope,
						linkCall.linkNode
					);
				});

				linkQueue = null;
			});

			return function delayedNodeLinkFn(_ignoreChildLinkFn, scope, linkNode) {
				if(linkQueue) {
					linkQueue.push({scope: scope, linkNode: linkNode});
				} else {
					afterTemplateNodeLinkFn(afterTemplateChildLinkFn, scope, linkNode);
				}
			};
		}

		// 指令实际compile函数
		function applyDirectivesToNode(directives, compileNode, attrs, previousCompileContext) {
			previousCompileContext = previousCompileContext || {};
			var $compileNode = $(compileNode);
			var terminalPriority = -Number.MAX_VALUE;
			var terminal = false;
			var preLinkFns = previousCompileContext.preLinkFns || [];
			var postLinkFns = previousCompileContext.postLinkFns || [];
			var controllers = {};
			var linkFns = [];
			var newScopeDirective;
			var newIsolateScopeDirective = previousCompileContext.newIsolateScopeDirective;
			var templateDirective = previousCompileContext.templateDirective;
			var controllerDirectives = previousCompileContext.controllerDirectives;

			// require配置 获取controllers的实现
			function getControllers(require, $element) {
				if(_.isArray(require)) {
					return _.map(require, function(r) {
						return getControllers(r, $element);
					});
				} else if(_.isObject(require)) {
					return _.mapValues(require, function(r) {
						return getControllers(r, $element);
					});
				} else {
					var value;
					var match = require.match(REQUIRE_PREFIX_REGEXP);
					var optional = match[2];

					require = require.substring(match[0].length);
					// 从祖先元素上找匹配的指令controller
					if(match[1] || match[3]) {
						if(match[3] && !match[1]) {
							match[1] = match[3];
						}

						if(match[1] === '^^') {
							$element = $element.parent();
						}

						while($element.length) {
							value = $element.data('$' + require + 'Controller');
							if(value) {
								break;
							} else {
								$element = $element.parent();
							}
						}


					} else {
						if(controllers[require]) {
							value = controllers[require].instance;
						}
					}

					if(!value && !optional) {
						throw 'Controller ' + require + ' required by directive, cannot be found!';
					}

					return value || null;
				}
			}

			function addLinkFns(preLinkFn, postLinkFn, attrStart, attrEnd, isolateScope, require) {
				if(preLinkFn) {
					if(attrStart) {
						preLinkFn = groupElementsLinkFnWrapper(preLinkFn, attrStart, attrEnd);
					}
					preLinkFn.isolateScope = isolateScope;
					preLinkFn.require = require;
					preLinkFns.push(preLinkFn);
				}
				if(postLinkFn) {
					if(attrEnd) {
						postLinkFn = groupElementsLinkFnWrapper(postLinkFn, attrStart, attrEnd);
					}
					postLinkFn.isolateScope = isolateScope;
					postLinkFn.require = require;
					postLinkFns.push(postLinkFn);
				}
			}

			_.forEach(directives, function(directive, i) {
				if(directive.$$start) {
					$compileNode = groupScan(compileNode, directive.$$start, directive.$$end);
				}

				if(directive.priority < terminalPriority) {
					return false;
				}

				// 一个element上的多个directive的scope创建规则
				if(directive.scope && !directive.templateUrl) {
					if(_.isObject(directive.scope)) {
						if(newIsolateScopeDirective || newScopeDirective) {
							throw 'Multiple directives asking for new/inherited scope';
						}

						newIsolateScopeDirective = directive;
					} else {
						if(newIsolateScopeDirective) {
							throw 'Multiple directives asking for new/inherited scope';
						}

						newScopeDirective = newScopeDirective || directive;
					}
				}

				// 指令template原理简单来说，就是如果directive defination object
				// 中有template配置，就拿template中的html string通过replace元素中的html
				// 即innerHTML替换
				if(directive.template) {
					if(templateDirective) {
						throw 'Multiple directives asking for template';
					}

					templateDirective = directive;
					$compileNode.html(_.isFunction(directive.template) ?
						directive.template($compileNode, attrs) :
						directive.template);
				}

				// 当定义templateUrl存在时，退出foreach循环，准备异步请求模版后再compile
				if(directive.templateUrl) {
					if(templateDirective) {
						throw 'Multiple directives asking for template';
					}

					templateDirective = directive;
					nodeLinkFn = compileTemplateUrl(
						_.drop(directives, i),
						$compileNode,
						attrs,
						{
							templateDirective: templateDirective,
							newIsolateScopeDirective: newIsolateScopeDirective,
							controllerDirectives: controllerDirectives,
							preLinkFns: preLinkFns,
							postLinkFns: postLinkFns
						}
					);
					return false;
				} else if(directive.compile) {
					// 这里link单个指令
					var linkFn = directive.compile($compileNode, attrs);
					var isolateScope = (directive === newIsolateScopeDirective);
					var attrStart = directive.$$start;
					var attrEnd = directive.$$end;
					var require = directive.require;

					if(_.isFunction(linkFn)) {
						addLinkFns(null, linkFn, attrStart, attrEnd, isolateScope, require);
					} else if(linkFn) {
						addLinkFns(linkFn.pre, linkFn.post, attrStart, attrEnd, isolateScope, require);
					}
				}


				//  teriminal为true的指令会中止这个dom上的compile
				if(directive.terminal) {
					terminal = true;
					terminalPriority = directive.priority;
				}

				// 获得对象 dirName: directive definition object
				// nodeLinkFn中实例化controller用到
				if(directive.controller) {
					controllerDirectives = controllerDirectives || {};
					controllerDirectives[directive.name] = directive;
				}
			});

			// link单个节点上的所有指令
			function nodeLinkFn(childLinkFn, scope, linkNode) {
				var $element = $(linkNode);

				var isolateScope;
				if(newIsolateScopeDirective) {
					isolateScope = scope.$new(true);
					$element.addClass('ng-isolate-scope');
					$element.data('$isolateScope', isolateScope);
				}

				// 实例化controllers
				if(controllerDirectives) {
					_.forEach(controllerDirectives, function(directive) {
						
						// 通过DI中的locals对象，使controller与directive联系紧密
						// 即能够在controller中获取到 scope，element，attrs
						var locals = {
							$scope: directive === newIsolateScopeDirective ? isolateScope:scope,
							$element: $element,
							$attrs: attrs
						};

						var controllerName = directive.controller;
						if(controllerName === '@') {
							controllerName = attrs[directive.name];
						}

						var controller = $controller(
							controllerName,
							locals,
							true,
							directive.controllerAs
						);

						controllers[directive.name] = controller;
						$element.data('$' + directive.name + 'Controller', controller.instance);
					});
				}

				// 各种data bindings的模式处理
				if (newIsolateScopeDirective) {
					initializeDirectiveBindings(
						scope,
						attrs,
						isolateScope,
						newIsolateScopeDirective.$$bindings.isolateScope,
						isolateScope
					);
				}

				var scopeDirective = newIsolateScopeDirective || newScopeDirective;
				if(scopeDirective && controllers[scopeDirective.name]) {
					initializeDirectiveBindings(
						scope,
						attrs,
						controllers[scopeDirective.name].instance,
						scopeDirective.$$bindings.bindToController,
						isolateScope
					);
				}

				// controller construction
				_.forEach(controllers, function(controller) {
					controller();
				});

				_.forEach(controllerDirectives, function(controllerDirective, name) {
					var require = controllerDirective.require;
					if(_.isObject(require) && !_.isArray(require) &&
						controllerDirective.bindToController) {
						var controller = controllers[controllerDirective.name].instance;
						var requiredControllers = getControllers(require, $element);
						_.assign(controller, requiredControllers);
					}
				});

				/* 这里是各个linkFn的执行
				* 可以看出执行顺序为 parentPreLink, childPreLink, childPostLink, parentPostLink
				 */
				_.forEach(preLinkFns, function(linkFn) {
					linkFn(
						linkFn.isolateScope ? isolateScope : scope,
						$element,
						attrs,
						linkFn.require && getControllers(linkFn.require, $element)
					);
				});

				if(childLinkFn) {
					var scopeToChild = scope;
					if(newIsolateScopeDirective &&
						(newIsolateScopeDirective.template ||
						newIsolateScopeDirective.templateUrl === null)) {
						scopeToChild = isolateScope;
					}

					childLinkFn(scopeToChild, linkNode.childNodes);
				}

				_.forEachRight(postLinkFns, function(linkFn) {
					linkFn(
						linkFn.isolateScope ? isolateScope : scope,
						$element,
						attrs,
						linkFn.require && getControllers(linkFn.require, $element)
					);
				});
			}

			nodeLinkFn.terminal = terminal;
			nodeLinkFn.scope = newScopeDirective && newScopeDirective.scope;

			return nodeLinkFn;
		}

		// 各种data bindings的模式处理
		function initializeDirectiveBindings(scope, attrs, destination, bindings, newScope) {
			_.forEach(
				bindings,
				function(definition, scopeName) {
					var attrName = definition.attrName;
					var parentGet, unwatch;

					switch(definition.mode) {
						case '@':
							// $observe监听attribute的改变,$set触发
							attrs.$observe(attrName, function(newAttrValue) {
								destination[scopeName] = newAttrValue;
							});
							// attribute初始化
							if(attrs[attrName]) {
								destination[scopeName] = attrs[attrName];
							}
							break;

						case '<':
							if(definition.optional && !attrs[attrName]) {
								break;
							}

							parentGet = $parse(attrs[attrName]);
							destination[scopeName] = parentGet(scope);

							unwatch = scope.$watch(parentGet, function(newValue) {
								destination[scopeName] = newValue;
							});

							newScope.$on('$destroy', unwatch);
							break;

						case '=':
							if(definition.optional && !attrs[attrName]) {
								break;
							}

							parentGet = $parse(attrs[attrName]);
							var lastValue = destination[scopeName] = parentGet(scope);
							// two-way-binding
							var parentValueWatch = function() {
								var parentValue = parentGet(scope);
								if(destination[scopeName] !== parentValue) {
									if(parentValue !== lastValue) {
										destination[scopeName] = parentValue;
									} else {
										parentValue = destination[scopeName];
										parentGet.assign(scope, parentValue);
									}
								}
								lastValue = parentValue;
								return lastValue;
							};

							if(definition.collection) {
								unwatch = scope.$watchCollection(attrs[attrName], parentValueWatch);
							} else {
								unwatch = scope.$watch(parentValueWatch);
							}

							newScope.$on('$destroy', unwatch);
							break;

						case '&':
							var parentExpr = $parse(attrs[attrName]);

							if(parentExpr === _.noop && definition.optional) {
								break;
							}

							destination[scopeName] = function(locals) {
								return parentExpr(scope, locals);
							};
							break;
					}
				}
			);
		}

		function groupScan(node, startAttr, endAttr) {
			var nodes = [];

			if(startAttr && node && node.hasAttribute(startAttr)) {
				var depth = 0;
				do {
					if(node.nodeType === Node.ELEMENT_NODE) {
						if(node.hasAttribute(startAttr)) {
							depth++;
						} else if(node.hasAttribute(endAttr)) {
							depth--;
						}
					}

					nodes.push(node);
					node = node.nextSibling;
				} while(depth > 0);

			} else {
				nodes.push(node);
			}

			return $(nodes);
		}

		function groupElementsLinkFnWrapper(linkFn, attrStart, attrEnd) {
			return function(scope, element, attrs, ctrl) {
				var group = groupScan(element[0], attrStart, attrEnd);
				return linkFn(scope, group, attrs, ctrl);
			};
		}

		function byPriority(a, b) {
			var diff = b.priority - a.priority;

			if(diff !== 0) {
				return diff;
			} else {
				if(a.name !== b.name) {
					return (a.name < b.name ? -1 : 1);
				} else {
					return a.index - b.index;
				}
			}
		}

		return compile;

	}];
}

$CompileProvider.$inject = ['$provide'];



















module.exports = $CompileProvider;