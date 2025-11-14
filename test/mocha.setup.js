// Don't silently swallow unhandled rejections
process.on('unhandledRejection', e => {
    throw e;
});

// enable the should interface with sinon
// and load chai-as-promised and sinon-chai by default
const sinonChai = require('sinon-chai');
const chaiAsPromised = require('chai-as-promised');
const { should, use, expect } = require('chai');

should();
use(sinonChai);
use(chaiAsPromised);

// Also make expect available globally for tests
global.expect = expect;
