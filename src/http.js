'use strict';

var _ = require('lodash');

/**** helper functions ****/
// 根据状态码进行判断请求是否成功
function isSuccess(status) {
	return status >= 200 && status < 300;
}

function isBlob(object) {
	return object.toString() === '[object Blob]';
}
function isFile(object) {
	return object.toString() === '[object File]';
}
function isFormData(object) {
	return object.toString() === '[object FormData]';
}

function isJsonLike(data) {
	if (data.match(/^\{(?!\{)/)) {
		return data.match(/\}$/);
	} else if (data.match(/^\[/)) {
		return data.match(/\]$/);
	}
}

// 根据params对象构造参数字符串
function serializeParams(params) {
	var parts = [];
	
	_.forEach(params, function(value, key) {
		if(_.isNull(value) || _.isUndefined(value)) {
			return;
		}

		parts.push(
			encodeURIComponent(key) + '=' + encodeURIComponent(value)
		);
	});
	
	return parts.join('&');
}

// 将参数字符串拼接成完整url
function buildUrl(url, serializedParams) {
	if (serializedParams.length) {
		url += (url.indexOf('?') === -1) ? '?' : '&';
		url += serializedParams;
	}
	return url;
}
/* helper functions end */


function defaultHttpResponseTransform(data, headers) {
	if(_.isString(data)) {
		var contentType = headers('Content-Type');
		if(contentType && contentType.indexOf('application/json') === 0 ||
			isJsonLike(data)) {
			return JSON.parse(data);
		}
	}

	return data;
}

function $HttpProvider() {

	var defaults = this.defaults = {
		headers: {
			common: {
				Accept: 'application/json, text/plain, */*'
			},
			post: {
				'Content-Type': 'application/json;charset=utf-8'
			},
			put: {
				'Content-Type': 'application/json;charset=utf-8'
			},
			patch: {
				'Content-Type': 'application/json;charset=utf-8'
			}
		},

		transformRequest: [function(data) {
			if(_.isObject(data) && !isBlob(data) && !isFile(data) && !isFormData(data)) {
				return JSON.stringify(data);
			} else {
				return data;
			}
		}],
		transformResponse: [defaultHttpResponseTransform]
	};

	//  处理headers里面键值对的值为函数的情况
	function executeHeaderFns(headers, config) {
		return _.transform(headers, function(result, v, k) {
			if(_.isFunction(v)) {
				v = v(config);

				if(_.isNull(v) || _.isUndefined(v)) {
					delete result[k];
				} else {
					result[k] = v;
				}
			}
		}, headers);
	}

	// responseheader的getter
	function headersGetter(headers) {
		var headersObj;

		return function(name) {
			headersObj = headersObj || parseHeaders(headers);

			if(name) {
				return headersObj[name.toLowerCase()];
			} else {
				return headersObj;
			}
		};
	}

	function parseHeaders(headers) {
		if(_.isObject(headers)) {
			return _.transform(headers, function(result, v, k) {
				result[_.trim(k.toLowerCase())] = _.trim(v);
			}, {});
		} else {
			var lines = headers.split('\n');
			return _.transform(lines, function(result, line) {
				var separatorAt = line.indexOf(':');
				var name = _.trim(line.substr(0, separatorAt)).toLowerCase();
				var value = _.trim(line.substr(separatorAt + 1));

				if(name) {
					result[name] = value;
				}

			}, {});
		}
	}

	// merge defaults 处理请求头
	function mergeHeaders(config) {
		var reqHeaders = _.extend(
			{},
			config.headers
		);

		var defHeaders = _.extend(
			{},
			defaults.headers.common,
			defaults.headers[(config.method || 'get').toLowerCase()]
		);

		_.forEach(defHeaders, function(value, key) {
			var headerExists = _.some(reqHeaders, function(v, k) {
				return k.toLowerCase() === key.toLowerCase();
			});

			if(!headerExists) {
				reqHeaders[key] = value;
			}
		});

		return executeHeaderFns(reqHeaders, config);
	}

	// 调用config.transformRequest中的函数,
	// 用于对data进行预处理
	function transformData(data, headers, status, transform) {
		if (_.isFunction(transform)) {
			return transform(data, headers, status);
		} else {
			return _.reduce(transform, function(data, fn) {
				return fn(data, headers, status);
			}, data);
		}
	}

	this.$get = ['$httpBackend', '$q', '$rootScope', function($httpBackend, $q, $rootScope) {

		// prepare request phase
		function $http(requestConfig) {

			var config = _.extend({
				method: 'GET',
				transformRequest: defaults.transformRequest,
				transformResponse: defaults.transformResponse
			}, requestConfig);

			config.headers = mergeHeaders(requestConfig);

			if(_.isUndefined(config.withCredentials) &&
				!_.isUndefined(defaults.withCredentials)
				) {
				config.withCredentials = defaults.withCredentials;
			}

			var reqData = transformData(
				config.data,
				headersGetter(config.headers),
				undefined,
				config.transformRequest
			);

			if(_.isUndefined(reqData)) {
				_.forEach(config.headers, function(v, k) {
					if(k.toLowerCase() === 'content-type') {
						delete config.headers[k];
					}
				});
			}

			function transformResponse(response) {
				if(response.data) {
					response.data = transformData(
						response.data,
						response.headers,
						response.status,
						config.transformResponse
					);
				}

				if(isSuccess(response.status)) {
					return response;
				} else {
					return $q.reject(response);
				}
			}

			return sendReq(config, reqData)
				.then(transformResponse, transformResponse);
		}

		// send requests phase
		function sendReq(config, reqData) {
			var deferred = $q.defer();

			function done(status, response, headersString, statusText) {
				status = Math.max(status, 0);

				deferred[isSuccess(status)?'resolve':'reject']({
					status: status,
					data: response,
					statusText: statusText,
					headers: headersGetter(headersString),
					config: config
				});

				// 主动调用 $apply, 触发$digest循环
				if(!$rootScope.$$phase) {
					$rootScope.$apply();
				}
			}

			// 支持params配置，拼接带参数的url
			var url = buildUrl(config.url, serializeParams(config.params));

			$httpBackend(
				config.method,
				url,
				reqData,
				done,
				config.headers,
				config.withCredentials
			);

			return deferred.promise;
		}



		$http.defaults = defaults;

		return $http;

	}];
}



module.exports = $HttpProvider;







