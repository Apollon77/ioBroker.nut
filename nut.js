/**
 *
 * NUT adapter
 *
 * Adapter loading NUT data from an UPS
 *
 */

"use strict";

var utils = require(__dirname + '/lib/utils'); // Get common adapter utils
var Nut   = require('node-nut');

var adapter = utils.adapter({
  name: 'nut',
  ready: function () {
    //oNut = new Nut(3493, 'localhost');
    oNut = new Nut(adapter.config.host_port, adapter.config.host_port);

    oNut.on('error', function(err) {
      adapter.log.error('There was an error: ' + err);
    });

    oNut.on('close', function() {
      adapter.log.debug('NUT Connection closed');
      setTimeout(function () {
        adapter.stop();
      }, 2000);
    });

    oNut.on('ready', function() {
      adapter.log.debug('NUT Connection ready');
      self = this;
      this.GetUPSVars(adapter.config.ups_name,function(varlist) {
        storeNutData(varlist);
        self.close();
      });
    });

    oNut.start();

    /*
    // force terminate after 1min
    // don't know why it does not terminate by itself...
    setTimeout(function () {
      adapter.log.warn('force terminate');
      process.exit(0);
    }, 60000);
    */
  }
});

function storeNutData(varlist) {
  // helper function to convert dot-separated string into object structure
  function setObjPath(obj, path, val, notation) {
    function isObject(obj) { return (Object.prototype.toString.call(obj) === '[object Object]' && !!obj);}
    notation = notation || '.';
    path.split(notation).reduce(function (prev, cur, idx, arr) {
      var isLast = (idx === arr.length - 1);
      // if <cur> is last part of path
      if (isLast) return (prev[cur] = val);
      // if <cur> is not last part of path, then returns object if existing value is object or empty object
      return (isObject(prev[cur])) ? prev[cur] : (prev[cur] = {});
    }, obj);

    return obj;
  };

  function createChannelsAndStates(obj,prependStr) {
    prependStr = prependStr || "";
    Object.keys(obj).forEach(function(key) {
      if (typeof obj[key] === 'string' || obj[key] instanceof String) {
        adapter.log.debug("Create State "+prependStr+key);
        adapter.setObjectNotExists(prependStr+key, {
            type: 'state',
            common: {name: prependStr+key},
            native: {id: prependStr+key}
        });
      }
      else {
        adapter.log.debug("Create Channel "+prependStr+key);
        adapter.setObjectNotExists(prependStr+key, {
            type: 'channel',
            role: 'info',
            common: {name: prependStr+key, type: "string", read: true, write: false},
            native: {}
        });
        createChannelsAndStates(obj[key],prependStr+key+".");
      }
    });
  }

  var valObj={};
  for (var key in varlist)
    setObjPath(valObj, key, varlist[key]);
  createChannelsAndStates(valObj);
  for (var key in varlist) {
    adapter.log.debug("Set State "+key+" = "+varlist[key]);
    adapter.setState(key, {ack: true, val: varlist[key]});
  }
  adapter.log.info("All Nut values set");
}
