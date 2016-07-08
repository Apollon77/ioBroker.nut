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
      adapter.log.error('Error happend: ' + err);
    });

    oNut.on('close', function() {
      adapter.log.debug('NUT Connection closed. Done.');
      setTimeout(function () {
        adapter.stop();
      }, 2000);
    });

    oNut.on('ready', function() {
      adapter.log.debug('NUT Connection ready');
      var self = this;
      this.GetUPSVars(adapter.config.ups_name,function(varlist) {
        adapter.log.debug('Got values, start setting them');
        storeNutData(varlist);
        self.close();
      });
    });

    oNut.start();
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
    adapter.log.debug('Create State '+stateName);
    adapter.setObjectNotExists(stateName, {
        type: 'state',
        common: {name: stateName, type: 'string', read: true, write: false},
        native: {id: stateName}
    });
    adapter.log.debug('Set State '+stateName+' = '+varlist[key]);
    adapter.setState(stateName, {ack: true, val: varlist[key]});
    last=current;
  }
  if (varlist['ups.status']) {
    adapter.log.debug('Create Channel status');
    adapter.setObjectNotExists(current, {
        type: 'channel',
        role: 'info',
        common: {name: 'status'},
        native: {}
    });
    var statusMap = { 'OL':'online',
              'OB':'onbattery',
              'LB':'lowbattery',
              'HB':'highbattery',
              'RB':'replacebattery',
              'CHRG':'charging',
              'DISCHRG':'discharging',
              'BYPASS':'bypass',
              'CAL':'calibration',
              'OFF':'offline',
              'OVER':'overload',
              'TRIM':'trimming',
              'BOOST':'boosting',
              'FSD':'shutdown'
            };

    var checker=' '+varlist['ups.status']+' ';
    for (var idx in statusMap) {
      if (statusMap.hasOwnProperty(idx)) {
        var found=(checker.indexOf(idx)>-1);
        stateName='status.'+statusMap[idx];
        adapter.log.debug('Create State '+stateName);
        adapter.setObjectNotExists(stateName, {
            type: 'state',
            common: {name: stateName, type: 'boolean', read: true, write: false},
            native: {id: stateName}
        });
        adapter.log.debug('Set State '+stateName+' = '+found);
        adapter.setState(stateName, {ack: true, val: found});
      }
    };
  }

  adapter.log.info('All Nut values set');
}
