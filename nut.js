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
    var oNut = new Nut(adapter.config.host_port, adapter.config.host_ip);

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
      var self = this;
      this.GetUPSVars(adapter.config.ups_name,function(varlist) {
        adapter.log.debug("Got values, start setting them");
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
  var last='';
  var current='';
  var index=0;
  var stateName='';

  for (var key in varlist) {
    index=key.indexOf('.');
    if (index > 0) {
      current=key.substring(0,index);
    }
    else {
      current='';
      last='';
      index=-1;
    }
    if (((last=='') || (last!=current)) && (current!='')) {
      adapter.log.debug('Create Channel '+current);
      adapter.setObjectNotExists(current, {
          type: 'channel',
          role: 'info',
          common: {name: current},
          native: {}
      });
    }
    stateName=current+'.'+key.substring(index+1).replace(/\./g,'-');
    adapter.log.debug("Create State "+stateName);
    adapter.setObjectNotExists(stateName, {
        type: 'state',
        common: {name: stateName, type: "string", read: true, write: false},
        native: {id: stateName}
    });
    last=current;
  }

  for (var key in varlist) {
    adapter.log.debug("Set State "+key+" = "+varlist[key]);
    adapter.setState(key, {ack: true, val: varlist[key]});
  }
  adapter.log.info("All Nut values set");
}
