// Don't silently swallow unhandled rejections
process.on('unhandledRejection', e => {
    throw e;
});

// Enable chai for assertions
const { expect } = require('chai');
global.expect = expect;
