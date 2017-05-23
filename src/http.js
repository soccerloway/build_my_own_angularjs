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

// 根据params对象构造参数字符串 service
function $HttpParamSerializerProvider() {
	this.$get = function() {
		return function serializeParams(params) {
			var parts = [];
			
			_.forEach(params, function(value, key) {
				if(_.isNull(value) || _.isUndefined(value)) {
					return;
				}

				if(!_.isArray(value)) {
					value = [value];
				}

				_.forEach(value, function(v) {
					if(_.isObject(v)) {
						v = JSON.stringify(v);
					}

					parts.push(
						encodeURIComponent(key) + '=' + encodeURIComponent(v)
					);
				});
			});
			
			return parts.join('&');
		};
	};
}

function $HttpParamSerializerJQLikeProvider() {
	this.$get = function() {
		return function(params) {
			var parts = [];

			function serialize(value, prefix, topLevel) {
				if (_.isNull(value) || _.isUndefined(value)) {
					return; 
				}

				if (_.isArray(value)) {
					_.forEach(value, function(v, i) {
						serialize(v, prefix +
							'[' +
							(_.isObject(v)? i : '') +
							']');
					});
				} else if (_.isObject(value) && !_.isDate(value)) {
					_.forEach(value, function(v, k) {
						serialize(v, prefix +
							(topLevel? '' : '[') +
							k +
							(topLevel? '' : ']'));
					});
				} else {
					parts.push(
						encodeURIComponent(prefix) + '=' + encodeURIComponent(value));
				}
			}			

			serialize(params, '', true);

			return parts.join('&');
		};
	};
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
	// http拦截器数组
	var interceptorFactories = this.interceptors = [];

	var useApplyAsync = false;
	this.useApplyAsync = function(value) {
		if(_.isUndefined(value)) {
			return useApplyAsync;
		} else {
			useApplyAsync = !!value;
			return this;
		}
	};

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
		transformResponse: [defaultHttpResponseTransform],
		paramSerializer: '$httpParamSerializer'
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

	this.$get = ['$httpBackend', '$q', '$rootScope', '$injector', function($httpBackend, $q, $rootScope, $injector) {

		var interceptors = _.map(interceptorFactories, function(fn) {
			return _.isString(fn)? $injector.get(fn) :
				$injector.invoke(fn);
		});
		
		// prepare request phase helper function,
		// run before any interceptors
		function serverRequest(config) {

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

		// prepare request phase
		function $http(requestConfig) {

			var config = _.extend({
				method: 'GET',
				transformRequest: defaults.transformRequest,
				transformResponse: defaults.transformResponse,
				paramSerializer: defaults.paramSerializer
			}, requestConfig);

			// 让paramSerializeer支持service名配置
			if(_.isString(config.paramSerializer)) {
				config.paramSerializer = $injector.get(config.paramSerializer);
			}

			config.headers = mergeHeaders(requestConfig);

			var promise = $q.when(config);

			// 将interceptor中的对应处理函数,用过promise.then加入执行队列中
			// 这个动作早于其他callback
			_.forEach(interceptors, function(interceptor) {
				promise = promise.then(interceptor.request, interceptor.requestError);
			});

			promise = promise.then(serverRequest);
			_.forEachRight(interceptors, function(interceptor) {
				promise = promise.then(interceptor.response, interceptor.responseError);
			});

			promise.success = function(fn) {
				promise.then(function(response) {
					fn(response.data, response.status, response.headers, config);
				});
				return promise;
			};

			promise.error = function(fn) {
				promise.catch(function(response) {
					fn(response.data, response.status, response.headers, config);
				});
				return promise;
			};

			return promise;

		}

		// send requests phase
		function sendReq(config, reqData) {
			var deferred = $q.defer();

			$http.pendingRequests.push(config);
			deferred.promise.then(function() {
				_.remove($http.pendingRequests, config);
			}, function() {
				_.remove($http.pendingRequests, config);
			});			

			function done(status, response, headersString, statusText) {
				status = Math.max(status, 0);

				function resolvePromise() {
					deferred[isSuccess(status)?'resolve':'reject']({
						status: status,
						data: response,
						statusText: statusText,
						headers: headersGetter(headersString),
						config: config
					});
				}

				if(useApplyAsync) {
					// 用applyAsync优化，合并$digest
					$rootScope.$applyAsync(resolvePromise);
				} else {
					resolvePromise();
					// 主动调用 $apply, 触发$digest循环
					if(!$rootScope.$$phase) {
						$rootScope.$apply();
					}
				}
			}

			// 支持params配置，拼接带参数的url
			var url = buildUrl(config.url, config.paramSerializer(config.params));

			$httpBackend(
				config.method,
				url,
				reqData,
				done,
				config.headers,
				config.timeout,
				config.withCredentials
			);

			return deferred.promise;
		}



		$http.defaults = defaults;
		$http.pendingRequests = [];

		// shorthand methods
		_.forEach(['get', 'head', 'delete'], function(method) {
			$http[method] = function(url, config) {
				return $http(_.extend(config || {}, {
					method: method.toUpperCase(),
					url: url
				}));
			};
		});

		_.forEach(['post', 'put', 'patch'], function(method) {
			$http[method] = function(url, data, config) {
				return $http(_.extend(config || {}, {
					method: method.toUpperCase(),
					url: url,
					data: data
				}));
			};
		});

		return $http;

	}];
}



module.exports = {
	$HttpProvider: $HttpProvider,
	$HttpParamSerializerProvider: $HttpParamSerializerProvider,
	$HttpParamSerializerJQLikeProvider: $HttpParamSerializerJQLikeProvider
};







