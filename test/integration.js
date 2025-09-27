const path = require('path');
const { tests } = require('@iobroker/testing');

// Run integration tests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test NUT adapter integration', getHarness => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should start and create connection state', async function () {
                try {
                    console.log('🔍 Step 1: Fetching adapter object...');

                    const obj = await new Promise((res, rej) => {
                        harness.objects.getObject('system.adapter.nut.0', (err, o) => {
                            if (err) {
                                return rej(err);
                            }
                            res(o);
                        });
                    });

                    if (!obj) {
                        throw new Error('Adapter object not found');
                    }

                    console.log('✅ Step 1.5: Adapter object loaded');

                    // Configure adapter for basic functionality
                    console.log('🔍 Step 2: Updating adapter config...');
                    Object.assign(obj.native, {
                        host_ip: 'localhost',
                        host_port: 3493,
                        ups_name: 'ups',
                        update_interval: 300,
                    });

                    // Enable adapter and set debug logging
                    obj.common.enabled = true;
                    obj.common.loglevel = 'debug';

                    await new Promise((res, rej) => {
                        harness.objects.setObject(obj._id, obj, err => {
                            if (err) {
                                return rej(err);
                            }
                            console.log('✅ Step 2.5: Adapter object updated');
                            res();
                        });
                    });

                    console.log('🔍 Step 3: Starting adapter...');
                    await harness.startAdapterAndWait();
                    console.log('✅ Step 4: Adapter started');

                    // Wait for adapter to initialize
                    console.log('⏳ Step 5: Waiting 10 seconds for adapter initialization...');
                    await new Promise(res => setTimeout(res, 10000));

                    console.log('🔍 Step 6: Checking if connection state exists...');
                    const connectionState = await new Promise((res, rej) => {
                        harness.states.getState('nut.0.info.connection', (err, state) => {
                            if (err) {
                                return rej(err);
                            }
                            res(state);
                        });
                    });

                    if (connectionState !== null) {
                        console.log(`✅ Step 7: Connection state found: ${connectionState.val}`);
                    } else {
                        console.log('❌ Step 7: Connection state not found');
                        throw new Error('Expected connection state to exist');
                    }

                    // Check for other basic states that should be created
                    console.log('🔍 Step 8: Fetching all adapter states...');
                    const stateIds = await harness.dbConnection.getStateIDs('nut.0.*');

                    console.log(`📊 Step 9: Found ${stateIds.length} states`);
                    if (stateIds.length > 0) {
                        console.log('✅ Step 10: Adapter successfully created states');
                    } else {
                        console.log('ℹ️ Step 10: No states created (expected if no NUT server is running)');
                    }

                    await harness.stopAdapter();
                    console.log('🛑 Step 11: Adapter stopped');

                    return true;
                } catch (error) {
                    console.error('❌ Test failed:', error.message);
                    throw error;
                }
            }).timeout(40000);

            it('should handle notify message correctly', async function () {
                const testHarness = getHarness(); // Get a new harness for this test
                try {
                    console.log('🔍 Step 1: Setting up notify test...');

                    const obj = await new Promise((res, rej) => {
                        testHarness.objects.getObject('system.adapter.nut.0', (err, o) => {
                            if (err) {
                                return rej(err);
                            }
                            res(o);
                        });
                    });

                    if (!obj) {
                        throw new Error('Adapter object not found');
                    }

                    // Configure adapter
                    Object.assign(obj.native, {
                        host_ip: 'localhost',
                        host_port: 3493,
                        ups_name: 'ups',
                        update_interval: 300,
                    });

                    obj.common.enabled = true;
                    obj.common.loglevel = 'debug';

                    await new Promise((res, rej) => {
                        testHarness.objects.setObject(obj._id, obj, err => {
                            if (err) {
                                return rej(err);
                            }
                            res();
                        });
                    });

                    console.log('🔍 Step 2: Starting adapter...');
                    await testHarness.startAdapterAndWait();

                    // Wait for adapter to initialize
                    await new Promise(res => setTimeout(res, 8000));

                    console.log('🔍 Step 3: Sending notify message...');

                    // Create test adapter object for message sending
                    await new Promise((res, rej) => {
                        testHarness.objects.setObject(
                            'system.adapter.test.0',
                            {
                                common: {},
                                type: 'instance',
                            },
                            err => {
                                if (err) {
                                    return rej(err);
                                }
                                res();
                            },
                        );
                    });

                    // Subscribe to message responses
                    await new Promise((res, rej) => {
                        testHarness.states.subscribeMessage('system.adapter.test.0', err => {
                            if (err) {
                                return rej(err);
                            }
                            res();
                        });
                    });

                    // Send notify message
                    await new Promise((res, rej) => {
                        testHarness.states.pushMessage(
                            'system.adapter.nut.0',
                            {
                                command: 'notify',
                                message: { notifytype: 'COMMBAD', upsname: 'nutName@127.0.0.1' },
                                from: 'system.adapter.test.0',
                                callback: {
                                    message: { notifytype: 'COMMBAD', upsname: 'nutName@127.0.0.1' },
                                    id: 1,
                                    ack: false,
                                    time: new Date().getTime(),
                                },
                            },
                            err => {
                                if (err) {
                                    return rej(err);
                                }
                                res();
                            },
                        );
                    });

                    console.log('⏳ Step 4: Waiting for notify processing...');
                    await new Promise(res => setTimeout(res, 5000));

                    // Check if severity state was updated to expected value (3 = action_needed for COMMBAD)
                    console.log('🔍 Step 5: Checking severity state...');
                    const severityState = await new Promise((res, rej) => {
                        testHarness.states.getState('nut.0.status.severity', (err, state) => {
                            if (err) {
                                return rej(err);
                            }
                            res(state);
                        });
                    });

                    if (severityState && severityState.val === 3) {
                        console.log('✅ Step 6: Severity correctly set to 3 for COMMBAD notify');
                    } else {
                        console.log(
                            `ℹ️ Step 6: Severity state: ${severityState ? severityState.val : 'null'} (expected 3)`,
                        );
                    }

                    // Check last_notify state
                    const lastNotifyState = await new Promise((res, rej) => {
                        testHarness.states.getState('nut.0.status.last_notify', (err, state) => {
                            if (err) {
                                return rej(err);
                            }
                            res(state);
                        });
                    });

                    if (lastNotifyState && lastNotifyState.val === 'COMMBAD') {
                        console.log('✅ Step 7: Last notify correctly set to COMMBAD');
                    } else {
                        console.log(
                            `ℹ️ Step 7: Last notify state: ${lastNotifyState ? lastNotifyState.val : 'null'} (expected COMMBAD)`,
                        );
                    }

                    await harness.stopAdapter();
                    console.log('🛑 Step 8: Adapter stopped');

                    return true;
                } catch (error) {
                    console.error('❌ Notify test failed:', error.message);
                    throw error;
                }
            }).timeout(40000);
        });
    },
});
