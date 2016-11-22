/**
 *
 * NUT adapter
 *
 * Adapter loading NUT data from an UPS
 *
 */
 /* jshint -W097 */// jshint strict:false
 /*jslint node: true */
'use strict';

var utils = require(__dirname + '/lib/utils'); // Get common adapter utils
var Nut   = require('node-nut');

var nutTimeout;

var adapter = utils.adapter('nut');

adapter.on('ready', function (obj) {
    main();
});

adapter.on('message', function (msg) {
    processMessage(msg);
});

adapter.on('stateChange', function (id, state) {
    adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
});

adapter.on('unload', function (callback) {
    if (nutTimeout) clearTimeout(nutTimeout);
});

process.on('SIGINT', function () {
    if (nutTimeout) clearTimeout(nutTimeout);
});

function main() {
    adapter.getForeignObject('system.adapter.' + adapter.namespace, function (err, obj) {
       if (obj.common.mode !== 'daemon') {
            obj.common.mode = 'daemon';
            if (obj.common.schedule) delete(obj.common.schedule);
            adapter.setForeignObject(obj._id, obj);
       }
    });
    adapter.setObjectNotExists('status.last_notify', {
        type: 'state',
        common: {
            name: 'status.last_notify',
            type: 'string',
            read: true,
            write: false,
        },
        native: {id: 'status.last_notify'}
    });
    adapter.getState('status.last_notify', function (err, state) {
        if (!state) {
            adapter.setState('status.last_notify', {ack: true, val: ''});
        }
        updateNutData();
    });
}

/*
Command Datapoint to be used with "NOIFY EVENTS" and upsmon
ONLINE   : The UPS is back on line.
ONBATT   : The UPS is on battery.
LOWBATT  : The UPS battery is low (as determined by the driver).
FSD      : The UPS has been commanded into the "forced shutdown" mode.
COMMOK   : Communication with the UPS has been established.
COMMBAD  : Communication with the UPS was just lost.
SHUTDOWN : The local system is being shut down.
REPLBATT : The UPS needs to have its battery replaced.
NOCOMM   : The UPS can’t be contacted for monitoring.
*/
function processMessage(message) {
    if (!message) return;

    adapter.log.info('Message received = ' + JSON.stringify(message));

    var updateNut = false;
    if (message.command === 'notify' && message.message) {
        adapter.log.info('got Notify ' + message.message.notifytype + ' for: ' + message.message.upsname);
        var ownName = adapter.config.ups_name + '@' + adapter.config.host_ip;
        adapter.log.info('ownName=' + ownName + ' --> ' + (ownName === message.message.upsname));
        if (ownName === message.message.upsname) {
            updateNut = true;
            adapter.setState('status.last_notify', {ack: true, val: message.message.notifytype});
            if (message.message.notifytype==='COMMBAD' || message.message.notifytype==='NOCOMM') parseAndSetSeverity("OFF");
        }
    }
    else updateNut = true;

    if (updateNut) {
        if (nutTimeout) clearTimeout(nutTimeout);
        updateNutData();
    }
}

function updateNutData() {
    adapter.log.info('Start NUT update');

    var update_interval = parseInt(adapter.config.update_interval,10) || 60;
    var oNut = new Nut(adapter.config.host_port, adapter.config.host_ip);

    oNut.on('error', function(err) {
        adapter.log.error('Error happend: ' + err);
        adapter.getState('status.last_notify', function (err, state) {
            if (!state || (state && state.val!=='COMMBAD' && state.val!=='SHUTDOWN' && state.val!=='NOCOMM')) {
                adapter.setState('status.last_notify', {ack: true, val: 'ERROR'});
            }
            parseAndSetSeverity("");
        });
    });

    oNut.on('close', function() {
        adapter.log.debug('NUT Connection closed. Done.');
    });

    oNut.on('ready', function() {
        adapter.log.debug('NUT Connection ready');
        var self = this;
        this.GetUPSVars(adapter.config.ups_name, function(varlist) {
            adapter.log.debug('Got values, start setting them');
            storeNutData(varlist);
            self.close();
        });
    });

    oNut.start();

    nutTimeout = setTimeout(updateNutData, update_interval*1000);
}

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
      if (((last==='') || (last!==current)) && (current!=='')) {
          adapter.log.debug('Create Channel '+current);
          adapter.setObjectNotExists(current, {
              type: 'channel',
              common: {name: current},
              native: {}
          });
      }
      stateName=current+'.'+key.substring(index+1).replace(/\./g,'-');
      adapter.log.debug('Create State '+stateName);
      if (stateName=='battery.charge') {
          adapter.setObjectNotExists(stateName, {
              type: 'state',
              common: {name: stateName, type: 'number', role: 'value.battery', read: true, write: false},
              native: {id: stateName}
          });
      }
      else {
          adapter.setObjectNotExists(stateName, {
              type: 'state',
              common: {name: stateName, type: 'string', read: true, write: false},
              native: {id: stateName}
          });
      }
      adapter.log.debug('Set State '+stateName+' = '+varlist[key]);
      adapter.setState(stateName, {ack: true, val: varlist[key]});
      last=current;
    }

    adapter.log.debug('Create Channel status');
    adapter.setObjectNotExists('status', {
        type: 'channel',
        common: {name: 'status'},
        native: {}
    });
    adapter.setObjectNotExists('status.severity', {
        type: 'state',
        common: {
            name: 'status.severity',
            role: 'indicator',
            type: 'number',
            read: true,
            write: false,
            def:4,
            states: '0:idle;1:operating;2:operating_critical;3:action_needed;4:unknown'
        },
        native: {id: 'status.severity'}
    });
    if (varlist['ups.status']) {
        parseAndSetSeverity(varlist['ups.status']);
    }
    else parseAndSetSeverity("");

    adapter.log.info('All Nut values set');
}

function parseAndSetSeverity(ups_status) {
    var statusMap = {
              'OL':{name:'online',severity:'idle'},
              'OB':{name:'onbattery',severity:'operating'},
              'LB':{name:'lowbattery',severity:'operating_critical'},
              'HB':{name:'highbattery',severity:'operating_critical'},
              'RB':{name:'replacebattery',severity:'action_needed'},
              'CHRG':{name:'charging',severity:'idle'},
              'DISCHRG':{name:'discharging',severity:'operating'},
              'BYPASS':{name:'bypass',severity:'action_needed'},
              'CAL':{name:'calibration',severity:'operating'},
              'OFF':{name:'offline',severity:'action_needed'},
              'OVER':{name:'overload',severity:'action_needed'},
              'TRIM':{name:'trimming',severity:'operating'},
              'BOOST':{name:'boosting',severity:'operating'},
              'FSD':{name:'shutdown',severity:'operating_critical'}
            };
    var severity = {
              'idle':false,
              'operating':false,
              'operating_critical':false,
              'action_needed':false
            };
    var checker=' '+ups_status+' ';
    var stateName="";
    for (var idx in statusMap) {
        if (statusMap.hasOwnProperty(idx)) {
            var found=(checker.indexOf(idx)>-1);
            stateName='status.'+statusMap[idx].name;
            adapter.log.debug('Create State '+stateName);
            adapter.setObjectNotExists(stateName, {
                type: 'state',
                common: {name: stateName, type: 'boolean', read: true, write: false},
                native: {id: stateName}
            });
            adapter.log.debug('Set State '+stateName+' = '+found);
            adapter.setState(stateName, {ack: true, val: found});
            if (found) {
                severity[statusMap[idx].severity]=true;
                adapter.log.debug('Severity Flag '+statusMap[idx].severity+'=true');
            }
        }
    }
    var severityVal = 4;
    if (severity.operating_critical) severityVal=2;
        else if (severity.action_needed) severityVal=3;
        else if (severity.operating) severityVal=1;
        else if (severity.idle) severityVal=0;

    adapter.log.debug('Set State status.severity = '+severityVal);
    adapter.setState('status.severity', {ack: true, val: severityVal});
}
