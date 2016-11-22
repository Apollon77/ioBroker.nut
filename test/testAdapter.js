var expect = require('chai').expect;
var setup  = require(__dirname + '/lib/setup');

var objects = null;
var states  = null;
var onStateChanged = null;
var onObjectChanged = null;
var sendToID = 1;

function checkConnectionOfAdapter(cb, counter) {
    counter = counter || 0;
    console.log('Try check #' + counter);
    if (counter > 20) {
        cb && cb('Cannot check connection');
        return;
    }

    states.getState('system.adapter.nut.0.alive', function (err, state) {
        if (err) console.error(err);
        if (state && state.val) {
            cb && cb();
        } else {
            setTimeout(function () {
                checkConnectionOfAdapter(cb, counter + 1);
            }, 1000);
        }
    });
}

function checkValueOfState(id, value, cb, counter) {
    counter = counter || 0;
    if (counter > 20) {
        cb && cb('Cannot check value Of State ' + id);
        return;
    }

    states.getState(id, function (err, state) {
        if (err) console.error(err);
        if (value === null && !state) {
            cb && cb();
        } else
        if (state && (value === undefined || state.val === value)) {
            cb && cb();
        } else {
            setTimeout(function () {
                checkValueOfState(id, value, cb, counter + 1);
            }, 500);
        }
    });
}

function sendTo(target, command, message, callback) {
    onStateChanged = function (id, state) {
        if (id === 'messagebox.system.adapter.test.0') {
            callback(state.message);
        }
    };

    states.pushMessage('system.adapter.' + target, {
        command:    command,
        message:    message,
        from:       'system.adapter.test.0',
        callback: {
            message: message,
            id:      sendToID++,
            ack:     false,
            time:    (new Date()).getTime()
        }
    });
}

describe('Test NUT adapter', function() {
    before('Test NUT adapter: Start js-controller', function (_done) {
        this.timeout(600000); // because of first install from npm

        setup.setupController(function () {
            var config = setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';

            //config.native.dbtype   = 'sqlite';

            setup.setAdapterConfig(config.common, config.native);

            setup.startController(true, function(id, obj) {}, function (id, state) {
                    if (onStateChanged) onStateChanged(id, state);
                },
                function (_objects, _states) {
                    objects = _objects;
                    states  = _states;
                    _done();
                });
        });
    });

    it('Test NUT adapter: Check if adapter started', function (done) {
        this.timeout(60000);
        checkConnectionOfAdapter(function (res) {
            if (res) console.log(res);
            objects.setObject('system.adapter.test.0', {
                    common: {

                    },
                    type: 'instance'
                },
                function () {
                    states.subscribeMessage('system.adapter.test.0');
                    done();
                });
        });
    });

    // We expect ERROR as last Notify necause no nut is running there
    after('Test NUT adapter: test initial state as ERROR', function (done) {
        this.timeout(25000);

        setTimeout(function() {
            states.getState('nut.0.status.last_notify', function (err, state) {
                if (err) console.error(err);
                if (!state) {
                    console.error('state "status.last_notify" not set');
                }
                else {
                    console.log('check status.last_notify ... ' + state.val);
                }
                expect(state.val).to.be.equal('ERROR');
                states.getState('nut.0.status.severity', function (err, state) {
                    if (err) console.error(err);
                    if (!state) {
                        console.error('state "status.severity" not set');
                    }
                    else {
                        console.log('check status.severity ... ' + state.val);
                    }
                    expect(state.val).to.be.equal(4);
                    done();
                });
            });
        }, 5000);
    });

    after('Test NUT adapter: send notify Message and receive answer', function (done) {
        this.timeout(25000);
        var now = new Date().getTime();

        console.log('send notify with "COMMBAD" to adapter ...');
        sendTo('nut.0', 'notify', {notifytype: 'COMMBAD', upsname: 'nutName@127.0.0.1'});
        setTimeout(function() {
            states.getState('nut.0.status.last_notify', function (err, state) {
                if (err) console.error(err);
                if (!state) {
                    console.error('state "status.last_notify" not set');
                }
                else {
                    console.log('check status.last_notify ... ' + state.val);
                }
                expect(state.val).to.be.equal('COMMBAD');
                done();
            });
        }, 2000);
    });

    after('Test NUT adapter: Stop js-controller', function (done) {
        this.timeout(10000);

        setup.stopController(function (normalTerminated) {
            console.log('Adapter normal terminated: ' + normalTerminated);
            done();
        });
    });
});
