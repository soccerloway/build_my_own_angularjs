'use strict';

var _ = require('lodash');

/* 初始化watcher.last */
function initWatchVal() {}

/* 为scope创建watchers的数组 */
function Scope() {
	this.$$watchers = [];  // 监听器数组
	this.$$lastDirtyWatch = null; // 每次digest循环的最后一个脏的watcher, 用于优化digest循环
}

/* $watch方法：向watchers数组中添加watcher对象，以便对应调用 */
Scope.prototype.$watch = function(watchFn, listenerFn, valueEq) {
	var watcher = {
		watchFn: watchFn,
		listenerFn: listenerFn || function() {},
		valueEq: !!valueEq,
		last: initWatchVal
	};

	this.$$watchers.push(watcher);
	this.$$lastDirtyWatch = null;
};

/* $digest方法: 遍历scope的watchers数组，并调用对应函数 */
Scope.prototype.$$digestOnce = function() {
	var self = this;
	var newValue, oldValue, dirty;

	_.forEach(this.$$watchers, function(watcher) {
		try {
			newValue = watcher.watchFn(self);
			oldValue = watcher.last;

			if(!self.$$areEqual(newValue, oldValue, watcher.valueEq)) {
				self.$$lastDirtyWatch = watcher;

				watcher.last = (watcher.valueEq ? _.cloneDeep(newValue) : newValue);
				
				watcher.listenerFn(newValue,
					(oldValue === initWatchVal? newValue : oldValue), self);
				dirty = true;
			} else if(self.$$lastDirtyWatch === watcher) {
				return false;
			}
		} catch(e) {
			console.error(e);
		}
	});
	return dirty;
};

// digest循环的外循环，保持循环直到没有脏值为止
Scope.prototype.$digest = function() {
	var ttl = 10;
	var dirty;
	this.$$lastDirtyWatch = null;

	do {
		dirty = this.$$digestOnce();

		if(dirty && !(ttl--)) {
			throw '10 digest iterations reached';
		}
	} while (dirty);
};

Scope.prototype.$$areEqual = function(newValue, oldValue, valueEq) {
	if(valueEq) {
		return _.isEqual(newValue, oldValue);
	} else {
		return newValue === oldValue ||
		(typeof newValue === 'number' && typeof oldValue ==='number' && isNaN(newValue) && isNaN(oldValue));
	}
};

module.exports = Scope;
