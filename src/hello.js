var _ = require('lodash');

module.exports = function sayHello(to) {
	return _.template('hello, <%= name%>!')({name: to});
};
