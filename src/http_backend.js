'use strict';

var _ = require('lodash');

function $HttpBackendProvider() {
	
	this.$get = function() {
		return function(method, url, post, callback, headers, timeout, withCredentials) {
			var xhr = new window.XMLHttpRequest();
			var timeoutId;

			xhr.open(method, url, true);

			// 根据$http传入的config，设置requestHeader
			_.forEach(headers, function(value, key) {
				xhr.setRequestHeader(key, value);
			});

			// 设置withCredentials, 支持CORS（跨域资源共享）
			if(withCredentials) {
				xhr.withCredentials = true;
			}

			xhr.send(post || null);

			xhr.onload = function() {
				if(!_.isUndefined(timeoutId)) {
					clearTimeout(timeoutId);
				}

				var response = ('response' in xhr) ? xhr.response : xhr.responseText;
				var statusText = xhr.statusText || '';

				callback(
					xhr.status,
					response,
					xhr.getAllResponseHeaders(),
					statusText
				);
			};

			xhr.onerror = function() {
				if(!_.isUndefined(timeoutId)) {
					clearTimeout(timeoutId);
				}

				callback(-1, null, '');
			};

			if(timeout && timeout.then) {
				timeout.then(function() {
					xhr.abort();
				});
			} else if(timeout > 0) {
				timeoutId = setTimeout(function() {
					xhr.abort();
				}, timeout);
			}
		};
	};
}





















module.exports = $HttpBackendProvider;




