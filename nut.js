/**
 *
 * NUT adapter
 *
 * Adapter loading NUT data from an UPS
 *
 */
 /* jshint -W097 */
 // jshint strict:true
 /*jslint node: true */
 /*jslint esversion: 6 */
'use strict';

const utils = require('@iobroker/adapter-core'); // Get common adapter utils
let adapter;

const Nut = require('node-nut');

let nutTimeout;
let stopInProgress;

let nutCommands = null;
let connected = null;

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: 'nut'
    });
    adapter = new utils.Adapter(options);


    adapter.on('ready', () => {
        main();
    });

    adapter.on('message', (msg) => {
        processMessage(msg);
    });

    adapter.on('stateChange', (id, state) => {
        adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
        const realNamespace = adapter.namespace + '.commands.';
        const stateId = id.substring(realNamespace.length);
        if (!state || state.ack || id.indexOf(realNamespace) !== 0) return;

        const command = stateId.replace(/-/g, '.');
        initNutConnection((oNut) => {
            if (!oNut) {
                adapter.log.error('USV not available - Error while sending command: ' + command);
                return;
            }
            if (stopInProgress) return; // adapter already unloaded
            if (adapter.config.username && adapter.config.password) {
                adapter.log.info('send username for command ' + command);
                oNut.SetUsername(adapter.config.username, (err) => {
                    if (err) {
                        adapter.log.error('Err while sending username: '+ err);
                        oNut.close();
                    }
                    else {
                        adapter.log.info('send password for command ' + command);
                        oNut.SetPassword(adapter.config.password,  (err) => {
                            if (err) {
                                adapter.log.error('Err while sending password: '+ err);
                                oNut.close();
                            }
                            else {
                                adapter.log.info('send command ' + command);
                                oNut.RunUPSCommand(adapter.config.ups_name, command,  (err) => {
                                    if (err) {
                                        adapter.log.error('Err while sending command ' + command + ': '+ err);
                                        oNut.close();
                                    }
                                    getCurrentNutValues(oNut, true);
                                });
                            }
                        });
                    }
                });
            }
            else {
                adapter.log.info('send command ' + command + ' without username and password');
                oNut.RunUPSCommand(adapter.config.ups_name, command,  (err) => {
                    if (err) {
                        adapter.log.error('Err while sending command ' + command + ': '+ err);
                    }
                    getCurrentNutValues(oNut, true);
                });
            }

            adapter.setState(id, {ack: true, val: false});
        });
    });

    adapter.on('unload', (callback) => {
        stopInProgress = true;
        if (nutTimeout) clearTimeout(nutTimeout);
        nutTimeout = null;
        try {
            setConnected(false);
        } finally {
            if (typeof callback === 'function') callback();
        }
    });

    return adapter;
}

function setConnected(isConnected) {
    if (connected !== isConnected) {
        connected = isConnected;
        adapter && adapter.setState('info.connection', connected, true, (err) => {
            // analyse if the state could be set (because of permissions)
            if (err && adapter && adapter.log) {
                adapter.log.error('Can not update connected state: ' + err);
            }
            else if (adapter && adapter.log) {
                adapter.log.debug('connected set to ' + connected);
            }
        });
    }
}

async function main() {
    setConnected(false);
    adapter.getForeignObject('system.adapter.' + adapter.namespace, (err, obj) => {
       if (!err && obj && (obj.common.mode !== 'daemon')) {
            obj.common.mode = 'daemon';
            if (obj.common.schedule) delete(obj.common.schedule);
            adapter.setForeignObject(obj._id, obj);
       }
    });

    adapter.log.debug('Create Channel status');
    try {
        await adapter.setObjectNotExistsAsync('status', {
            type: 'channel',
            common: {name: 'status'},
            native: {}
        });
    } catch (err) {
        adapter.log.error('Error creating Channel: ' + err);
    }
    try {
        await adapter.setObjectNotExistsAsync('status.severity', {
            type: 'state',
            common: {
                name: 'status.severity',
                role: 'indicator',
                type: 'number',
                read: true,
                write: false,
                def: 4,
                states: {0: 'idle', 1: 'operating', 2: 'operating_critical', 3: 'action_needed', 4: 'unknown'}
            },
            native: {id: 'status.severity'}
        });
    } catch (err) {
        adapter.log.error('Error creating State: ' + err);
    }
    await parseAndSetSeverity("", true);
    try {
        await adapter.setObjectNotExistsAsync('status.last_notify', {
            type: 'state',
            common: {
                name: 'status.last_notify',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: 'status.last_notify'
            }
        });
    } catch (err) {
        adapter.log.error('Error creating State: ' + err);
    }
    adapter.getState('status.last_notify', async  (err, state) => {
        if (!err && !state) {
            await adapter.setStateAsync('status.last_notify', {ack: true, val: ''});
        }
        initializeNutDevice();
    });
}

function initializeNutDevice() {
    const update_interval = parseInt(adapter.config.update_interval,10) || 60;

    initNutConnection((oNut) => {
        if (!oNut) {
            adapter.log.error('USV not available - Delay initialization');

            nutTimeout = setTimeout(initializeNutDevice, update_interval * 1000);

            return;
        }
        oNut.GetUPSCommands(adapter.config.ups_name, (cmdlist, err) => {
            if (err) {
                adapter.log.error('Err while getting all commands: '+ err);
            }
            else {
                adapter.log.debug('Got commands, create and subscribe command states');
                initNutCommands(cmdlist);
            }

            getCurrentNutValues(oNut, true);

            nutTimeout = setTimeout(updateNutData, update_interval * 1000);
        });
    });
}

async function initNutCommands(cmdlist) {
    adapter.log.debug('Create Channel commands');
    try {
        await adapter.setObjectNotExistsAsync('commands', {
            type: 'channel',
            common: {name: 'commands'},
            native: {}
        });
    } catch (err) {
        adapter.log.error('Error creating Channel: ' + err);
    }

    if (! cmdlist) return;
    nutCommands = cmdlist;
    for (let i = 0; i < cmdlist.length; i++) {
        const cmdName = cmdlist[i].replace(/\./g, '-');
        adapter.log.debug('Create State commands.' + cmdName);
        try {
            await adapter.setObjectNotExistsAsync('commands.' + cmdName, {
                type: 'state',
                common: {
                    name: 'commands.' + cmdName,
                    role: 'button',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false
                },
                native: {id: 'commands.' + cmdName}
            });
        } catch (err) {
            adapter.log.error('Error creating State: ' + err);
        }
        await adapter.setStateAsync('commands.' + cmdName, {ack: true, val: false});
    }
    adapter.subscribeStates('commands.*');
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

    let updateNut = false;
    if (message.command === 'notify' && message.message) {
        adapter.log.info('got Notify ' + message.message.notifytype + ' for: ' + message.message.upsname);
        const ownName = adapter.config.ups_name + '@' + adapter.config.host_ip;
        adapter.log.info('ownName=' + ownName + ' --> ' + (ownName === message.message.upsname));
        if (ownName === message.message.upsname) {
            updateNut = true;
            adapter.setState('status.last_notify', {ack: true, val: message.message.notifytype});
            if (message.message.notifytype==='COMMBAD' || message.message.notifytype==='NOCOMM') {
                parseAndSetSeverity("OFF");
            }
        }
    }
    else updateNut = true;

    if (updateNut) {
        if (nutTimeout) clearTimeout(nutTimeout);
        updateNutData();
    }
}

function initNutConnection(callback) {
    adapter.config.host_port = parseInt(adapter.config.host_port);
    if ((adapter.config.host_port < 0 || adapter.config.host_port > 65535) || isNaN(adapter.config.host_port)) {
        adapter.log.error('Configured Port invalid: ' + adapter.config.host_port);
        adapter.terminate ? adapter.terminate(utils.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION) : process.exit(utils.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
        return;
    }

    const oNut = new Nut(adapter.config.host_port, adapter.config.host_ip);

    oNut.on('error', (err) => {
        if (stopInProgress) return; // adapter already unloaded
        adapter.log.error('Error happened: ' + err);
        setConnected(false);
        adapter.getState('status.last_notify', (err, state) => {
            if (!err && !state || (state && state.val!=='COMMBAD' && state.val!=='SHUTDOWN' && state.val!=='NOCOMM')) {
                adapter.setState('status.last_notify', {ack: true, val: 'ERROR'});
            }
            if (!err) parseAndSetSeverity("");
            callback(null);
        });
    });

    oNut.on('close', () => {
        adapter.log.debug('NUT Connection closed. Done.');
    });

    oNut.on('ready', () => {
        adapter.log.debug('NUT Connection ready');
        setConnected(true);
        callback(oNut);
    });

    oNut.start();
}

function updateNutData() {
    adapter.log.debug('Start NUT update');

    initNutConnection((oNut) => {
        oNut && getCurrentNutValues(oNut, true);
    });

    const update_interval = parseInt(adapter.config.update_interval, 10) || 60;
    nutTimeout = setTimeout(updateNutData, update_interval * 1000);
}

function getCurrentNutValues(oNut, closeConnection) {
    oNut.GetUPSVars(adapter.config.ups_name, (varlist, err) => {
        if (err) {
            adapter.log.error('Err while getting NUT values: '+ err);
        }
        else {
            adapter.log.debug('Got values, start setting them');
            storeNutData(varlist);
        }
        if (closeConnection) oNut.close();
    });
}

async function storeNutData(varlist) {
    let last = '';
    let current = '';
    let index = 0;
    let stateName = '';

    for (let key in varlist) {
        if (!varlist.hasOwnProperty(key)) continue;

        index = key.indexOf('.');
        if (index > 0) {
            current = key.substring(0, index);
        }
        else {
            current = '';
            last = '';
            index = -1;
        }
        if (((last === '') || (last !== current)) && (current !== '')) {
            adapter.log.debug('Create Channel ' + current);
            try {
                await adapter.setObjectNotExistsAsync(current, {
                    type: 'channel',
                    common: {
                        name: current
                    },
                    native: {}
                });
            } catch (err) {
                adapter.log.error(`Error creating Channel: ${err}`);
            }
        }
        stateName = current + '.' + key.substring(index + 1).replace(/\./g,'-');
        adapter.log.debug(`Create State ${stateName}`);
        if (stateName === 'battery.charge') {
            try {
                // it has type string but should be an integer
                varlist[key] = parseInt(varlist[key])
                await adapter.setObjectNotExistsAsync(stateName, {
                    type: 'state',
                    common: {name: stateName, type: 'number', role: 'value.battery', read: true, write: false, unit: '%'},
                    native: {id: stateName}
                });
            } catch (err) {
                adapter.log.error('Error creating State: ' + err);
            }
        }
        else {
            try {
                await adapter.setObjectNotExistsAsync(stateName, {
                    type: 'state',
                    common: {name: stateName, type: 'string', read: true, write: false},
                    native: {id: stateName}
                });
            } catch (err) {
                adapter.log.error('Error creating State: ' + err);
            }
        }
        adapter.log.debug(`Set State ${stateName} = ${varlist[key]}`);
        await adapter.setStateAsync(stateName, {ack: true, val: varlist[key]});
        last = current;
    }

    if (varlist['ups.status']) {
        await parseAndSetSeverity(varlist['ups.status']);
    }
    else {
        await parseAndSetSeverity("");
    }

    adapter.log.debug('All Nut values set');
}

async function parseAndSetSeverity(ups_status, createObjects) {
    const statusMap = {
        'OL': {name: 'online', severity: 'idle'},
        'OB': {name: 'onbattery', severity: 'operating'},
        'LB': {name: 'lowbattery', severity: 'operating_critical'},
        'HB': {name: 'highbattery', severity: 'operating_critical'},
        'RB': {name: 'replacebattery', severity: 'action_needed'},
        'CHRG': {name: 'charging', severity: 'idle'},
        'DISCHRG': {name: 'discharging', severity: 'operating'},
        'BYPASS': {name: 'bypass', severity: 'action_needed'},
        'CAL': {name: 'calibration', severity: 'operating'},
        'OFF': {name: 'offline', severity: 'action_needed'},
        'OVER': {name: 'overload', severity: 'action_needed'},
        'TRIM': {name: 'trimming', severity: 'operating'},
        'BOOST': {name: 'boosting', severity: 'operating'},
        'FSD': {name: 'shutdown', severity: 'operating_critical'}
    };
    const severity = {
        'idle': false,
        'operating': false,
        'operating_critical': false,
        'action_needed': false
    };
    if (ups_status.indexOf('FSD') !== -1) {
        ups_status += ' OB LB';
    }
    const checker = ' ' + ups_status + ' ';
    let stateName = "";
    for (var idx in statusMap) {
        if (statusMap.hasOwnProperty(idx)) {
            const found = (checker.indexOf(' ' + idx) > -1);
            stateName = 'status.' + statusMap[idx].name;
            adapter.log.debug('Create State ' + stateName);
            try {
                createObjects && await adapter.setObjectNotExistsAsync(stateName, {
                    type: 'state',
                    common: {name: stateName, type: 'boolean', read: true, write: false},
                    native: {id: stateName}
                });
            } catch (err) {
                adapter.log.error('Error creating State: ' + err);
            }
            adapter.log.debug('Set State '+stateName+' = '+found);
            await adapter.setStateAsync(stateName, {ack: true, val: found});
            if (found) {
                severity[statusMap[idx].severity] = true;
                adapter.log.debug('Severity Flag ' + statusMap[idx].severity + '=true');
            }
        }
    }
    let severityVal = 4;
    if (severity.operating_critical) severityVal = 2;
        else if (severity.action_needed) severityVal = 3;
        else if (severity.operating) severityVal = 1;
        else if (severity.idle) severityVal = 0;

    adapter.log.debug('Set State status.severity = ' + severityVal);
    await adapter.setStateAsync('status.severity', {ack: true, val: severityVal});
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
