/* jshint -W097 */// jshint strict:false
/*jslint node: true */
var expect = require('chai').expect;

var fileContentIOPackage = fs.readFileSync(__dirname + '/../io-package.json');
var ioPackage = JSON.parse(fileContentIOPackage);

var fileContentNPMPackage = fs.readFileSync(__dirname + '/../package.json');
var npmPackage = JSON.parse(fileContentNPMPackage);

expect(ioPackage).to.be.an('object');
expect(npmPackage).to.be.an('object');

expect(ioPackage.version).to.exist;
expect(npmPackage.version).to.exist;

expect(ioPackage.version).to.be.equal(npmPackage.version);
