const path = require('path');
const { tests } = require('@iobroker/testing');

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test NUT adapter startup', getHarness => {
            it('should start adapter and check initial state as ERROR', async function () {
                const harness = getHarness();
                this.timeout(60000);

                // Configure adapter using harness method
                await harness.changeAdapterConfig('nut', {
                    native: {
                        host_ip: 'localhost',
                        host_port: 3493,
                        ups_name: 'ups',
                        update_interval: 300,
                    },
                    common: {
                        enabled: true,
                        loglevel: 'debug',
                    },
                });

                // Start the adapter
                await harness.startAdapterAndWait();

                // Wait for adapter to initialize - NUT adapter needs time to attempt connection and fail
                await new Promise(res => setTimeout(res, 15000));

                // Check if connection state exists using promise-based method with assertions
                const connectionState = await harness.states.getStateAsync('nut.0.info.connection');
                expect(connectionState, 'Connection state should exist').to.not.be.null;
                expect(connectionState.val, 'Connection should be false when no NUT server available').to.be.false;

                // Test initial state - We expect ERROR as last_notify because no NUT server is running
                const lastNotifyState = await harness.states.getStateAsync('nut.0.status.last_notify');
                expect(lastNotifyState, 'Last notify state should exist').to.not.be.null;
                expect(lastNotifyState.val, 'Should show ERROR when no NUT server available').to.equal('ERROR');

                const severityState = await harness.states.getStateAsync('nut.0.status.severity');
                expect(severityState, 'Severity state should exist').to.not.be.null;
                expect(severityState.val, 'Should show severity 4 (unknown) when no NUT server available').to.equal(4);

                // Check for other basic states that should be created
                const stateIds = await harness.dbConnection.getStateIDs('nut.0.*');
                expect(stateIds, 'Adapter should create states').to.be.an('array');
                expect(stateIds.length, 'Should have created multiple states').to.be.greaterThan(0);

                await harness.stopAdapter();
            });
        });

        suite('Test NUT adapter notify messages', getHarness => {
            it('should handle notify messages correctly', async function () {
                const harness = getHarness();
                this.timeout(30000);

                // Configure adapter using harness method
                await harness.changeAdapterConfig('nut', {
                    native: {
                        host_ip: 'localhost',
                        host_port: 3493,
                        ups_name: 'ups',
                        update_interval: 300,
                    },
                    common: {
                        enabled: true,
                        loglevel: 'debug',
                    },
                });

                // Start the adapter
                await harness.startAdapterAndWait();

                // Wait for initial setup
                await new Promise(res => setTimeout(res, 8000));

                // Create test adapter object for message sending
                await harness.objects.setObjectAsync('system.adapter.test.0', {
                    common: {},
                    type: 'instance',
                });

                // Subscribe to message responses
                await new Promise((resolve, reject) => {
                    harness.states.subscribeMessage('system.adapter.test.0', err => {
                        if (err) {
                            return reject(err);
                        }
                        resolve();
                    });
                });

                // Send the notify message
                harness.states.pushMessage('system.adapter.nut.0', {
                    command: 'notify',
                    message: { notifytype: 'COMMBAD', upsname: 'ups@localhost' },
                    from: 'system.adapter.test.0',
                    callback: {
                        message: { notifytype: 'COMMBAD', upsname: 'ups@localhost' },
                        id: 1,
                        ack: false,
                        time: new Date().getTime(),
                    },
                });

                // Wait for message processing
                await new Promise(res => setTimeout(res, 3000));

                await harness.stopAdapter();
            });
        });
    },
});
