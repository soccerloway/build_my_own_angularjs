'use strict';

var _ = require('lodash');

// 这个正则能去除函数的参数部分 但参数之前的whitespace被保留了
var FN_ARGS = /^function\s*[^\(]*\(\s*([^\)]*)\)/m;

// 这个正则去掉参数前面的空格
var FN_ARG = /^\s*(_?)(\S+?)\1\s*$/;

// 丢掉注释 的正则
var STRIP_COMMENTS = /(\/\/.*$)|(\/\*.*?\*\/)/mg;


function createInjector(modulesToLoad, strictDi) {
	var cache = {};
	var loadedModules = {};
	strictDi = (strictDi === true);

	var $provide = {
		constant: function(key, value) {
			if(key === 'hasOwnProperty') {
				throw 'hasOwnProperty is not a valid constant name!';
			} else {
				cache[key] = value;
			}
		}
	};

	// 这个函数中的3种处理分别对应了 angular中依赖注入的3种注释形式
	// 分别是 ['x', 'x', fn], $inject = [], 无注入, 隐式注入 
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
				throw 'fn is not using explicit annotation and ' +
					'cannot be invoked in strict mode';
			}

			var source = fn.toString().replace(STRIP_COMMENTS, '');
			var argDeclaration = source.match(FN_ARGS);

			return _.map(argDeclaration[1].split(','), function(argName) {
				return argName.match(FN_ARG)[2];
			});
		}
	}

	// dependencies inject
	function invoke(fn, self, locals) {
		var args = _.map(annotate(fn), function(token) {
			if(_.isString(token)) {
				return locals && locals.hasOwnProperty(token) ? locals[token] : cache[token];
			} else {
				throw 'Incorrect injection token! Expected a string, got ' + token;
			}
		});

		if(_.isArray(fn)) {
			fn = _.last(fn);
		}

		return fn.apply(self, args);
	}

	// 配合DI实例化对象
	function instantiate(Type) {
		var instance = {};
		invoke(Type, instance);
		return instance;
	}

	_.forEach(modulesToLoad, function loadModule(moduleName) {
		if(!loadedModules.hasOwnProperty(moduleName)) {
			loadedModules[moduleName] = true;

			var module = window.angular.module(moduleName);
			_.forEach(module.requires, loadModule);

			_.forEach(module._invokeQueue, function(invokeArgs) {
				var method = invokeArgs[0];
				var args = invokeArgs[1];
				$provide[method].apply($provide, args);
			});
		}
	});

	return {
		has: function(key) {
			return cache.hasOwnProperty(key);
		},

		get: function(key) {
			return cache[key];
		},
		annotate: annotate,
		invoke: invoke,
		instantiate: instantiate
	};
}




module.exports = createInjector;
