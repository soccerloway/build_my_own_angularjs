'use strict';

var _ = require('lodash');

function setupModuleLoader(window) {
	var ensure = function(obj, name, factory) {
		return obj[name] || (obj[name] = factory());
	};

	var angular = ensure(window, 'angular', Object);

	var createModule = function(name, requires, modules, configFn) {
		// 禁止注册 hasOwnProperty 为名字的module
		if(name === 'hasOwnProperty') {
			throw 'hasOwnProperty is not a valid module name';
		}

		var invokeQueue = [];  // 创建modules时, injector执行的队列 依赖注入
		var configBlocks = []; // configBlocks队列 

		// 对向invokeQueue里面push对象的封装
		var invokeLater = function(service, method, arrayMethod, queue) {
			return function() {
				queue = queue || invokeQueue;
				queue[arrayMethod ||'push']([service, method, arguments]);
				return moduleInstance;
			};
		};

		var moduleInstance = {
			name: name,
			requires: requires,
			constant: invokeLater('$provide', 'constant', 'unshift'),
			provider: invokeLater('$provide', 'provider'),
			config: invokeLater('$injector', 'invoke', 'push', configBlocks),
			_invokeQueue: invokeQueue,
			_configBlocks: configBlocks
		};

		if(configFn) {
			moduleInstance.config(configFn);
		}

		modules[name] = moduleInstance;
		return moduleInstance;
	};

	var getModule = function(name, modules) {
		if(modules.hasOwnProperty(name)) {
			return modules[name];
		} else {
			throw 'Module ' + name + ' is not available!';
		}

		return modules[name];
	};

	ensure(angular, 'module', function() {
		var modules = {};

		return function(name, requires, configFn) {
			if(requires) {
				return createModule(name, requires, modules, configFn);
			} else {
				return getModule(name, modules);
			}
		};
	});
}

module.exports = setupModuleLoader;