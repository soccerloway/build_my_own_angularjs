'use strict';

var _ = require('lodash');

function $HttpBackendProvider() {
	
	this.$get = function() {
		return function(method, url, post, callback, headers, withCredentials) {
			var xhr = new window.XMLHttpRequest();
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
				callback(-1, null, '');
			};
		};
	};
}





















module.exports = $HttpBackendProvider;




