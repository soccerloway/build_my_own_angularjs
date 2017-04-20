'use strict';

var _ = require('lodash');

/*
angular xxx | filter: xxx 的实现

如果filterExpr是一个function, 就当作断言去作用于数组每一项，

如果是string，就创建一个断言function，
	筛选主体是 数组，返回数组item包含有string的项(忽略大小写),
	筛选主体是 对象的数组，返回对象属性里面包含string的项

如果识别不了表达式，不知道做什么，就返回输入的array;
*/
function filterFilter() {
	return function(array, filterExpr, comparator) {
		var predicateFn;
		if(_.isFunction(filterExpr)) {
			predicateFn = filterExpr;
		} else if(_.isString(filterExpr) ||
				_.isNumber(filterExpr) ||
				_.isBoolean(filterExpr) ||
				_.isNull(filterExpr) ||
				_.isObject(filterExpr)
			) {
			predicateFn = createPredicateFn(filterExpr, comparator);
		} else {
			return array;
		}

		return _.filter(array, predicateFn);
	};
}

// 表达式是 string时的处理函数
function createPredicateFn(expression, comparator) {
	var shouldMatchPrimitives = _.isObject(expression) && ('$' in expression);

	// 比较器
	if(comparator === true) {
		comparator = _.isEqual;
	} else if(!_.isFunction(comparator)) {
		comparator = function(actual, expected) {
			if(_.isUndefined(actual)) {
				return false;
			}

			if(_.isNull(actual) || _.isNull(expected)) {
				return actual === expected;
			}

			actual = ('' + actual).toLowerCase();
			expected = ('' + expected).toLowerCase();
			return actual.indexOf(expected) !== -1;
		};
	}

	return function predicateFn(item) {
		if(shouldMatchPrimitives && !_.isObject(item)) {
			return deepCompare(item, expression.$, comparator);
		}

		return deepCompare(item, expression, comparator, true);
	};
}

// deeply compare 对数组里对象的每一个属性进行匹配的函数
function deepCompare(actual, expected, comparator, matchAnyProperty, inWildcard) {
	if(_.isString(expected) && _.startsWith(expected, '!')) {
		return !deepCompare(actual, expected.substring(1), comparator, matchAnyProperty);
	}

	if(_.isArray(actual)) {
		return _.some(actual, function(actualItem) {
			return deepCompare(actualItem, expected, comparator, matchAnyProperty);
		});
	}

	if(_.isObject(actual)) {
		if(_.isObject(expected) && !inWildcard) {

			return _.every(_.toPlainObject(expected), function(expectedVal, expectedKey) {
				if(_.isUndefined(expectedVal)) {
					return true;
				}

				var isWildcard = (expectedKey === '$');
				var actualVal = isWildcard ? actual : actual[expectedKey];

				return deepCompare(actualVal, expectedVal, comparator, isWildcard, isWildcard);
			});

		} else if(matchAnyProperty) {
			return _.some(actual, function(value, key) {
				return deepCompare(value, expected, comparator, matchAnyProperty);
			});
		} else {
			return comparator(actual, expected);
		}
	} else {
		return comparator(actual, expected);
	}
}














module.exports = filterFilter;