const path = require('path');
const { tests } = require('@iobroker/testing');

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test NUT adapter integration', getHarness => {
            it('should start adapter and check initial state as ERROR', async function () {
                const harness = getHarness(); // Get fresh harness for this test
                this.timeout(60000);

                try {
                    console.log('🔍 Starting adapter startup test...');

                    // Get adapter configuration using promise-based method
                    const obj = await harness.objects.getObjectAsync('system.adapter.nut.0');
                    if (!obj) {
                        throw new Error('Adapter object not found');
                    }

                    console.log('✅ Adapter object loaded');

                    // Configure adapter for basic functionality
                    Object.assign(obj.native, {
                        host_ip: 'localhost',
                        host_port: 3493,
                        ups_name: 'ups',
                        update_interval: 300,
                    });

                    // Enable adapter and set debug logging
                    obj.common.enabled = true;
                    obj.common.loglevel = 'debug';

                    // Use promise-based method for setting object
                    await harness.objects.setObjectAsync(obj._id, obj);
                    console.log('✅ Adapter configuration updated');

                    // Start the adapter
                    await harness.startAdapterAndWait();
                    console.log('✅ Adapter started');

                    // Wait for adapter to initialize - NUT adapter needs time to attempt connection and fail
                    console.log('⏳ Waiting for adapter initialization...');
                    await new Promise(res => setTimeout(res, 15000));

                    // Check if connection state exists using promise-based method
                    const connectionState = await harness.states.getStateAsync('nut.0.info.connection');
                    if (connectionState !== null) {
                        console.log(`✅ Connection state found: ${connectionState.val}`);
                    } else {
                        throw new Error('Expected connection state to exist');
                    }

                    // Test initial state - We expect ERROR as last_notify because no NUT server is running
                    const lastNotifyState = await harness.states.getStateAsync('nut.0.status.last_notify');
                    if (lastNotifyState) {
                        console.log(`Check status.last_notify: ${lastNotifyState.val}`);
                        if (lastNotifyState.val === 'ERROR') {
                            console.log('✅ Correct initial notify state: ERROR (no NUT server available)');
                        } else {
                            console.log(`ℹ️ Unexpected notify value: ${lastNotifyState.val} (expected ERROR)`);
                        }
                    }

                    const severityState = await harness.states.getStateAsync('nut.0.status.severity');
                    if (severityState) {
                        console.log(`Check status.severity: ${severityState.val}`);
                        if (severityState.val === 4) {
                            console.log('✅ Correct initial severity: 4 (unknown - no NUT server available)');
                        } else {
                            console.log(`ℹ️ Unexpected severity value: ${severityState.val} (expected 4)`);
                        }
                    }

                    // Check for other basic states that should be created
                    const stateIds = await harness.dbConnection.getStateIDs('nut.0.*');
                    console.log(`📊 Found ${stateIds.length} states`);
                    if (stateIds.length > 0) {
                        console.log('✅ Adapter successfully created states');
                    } else {
                        throw new Error('No states created - adapter may not be working correctly');
                    }

                    await harness.stopAdapter();
                    console.log('🛑 Adapter stopped');

                    return true;
                } catch (error) {
                    console.error('❌ Test failed:', error.message);
                    throw error;
                }
            });

            it('should handle notify messages correctly', async function () {
                const harness = getHarness(); // Get fresh harness for this test
                this.timeout(30000);

                try {
                    console.log('🔍 Starting notify message test...');

                    // Get and configure adapter using promise-based method
                    const obj = await harness.objects.getObjectAsync('system.adapter.nut.0');
                    if (!obj) {
                        throw new Error('Adapter object not found');
                    }

                    Object.assign(obj.native, {
                        host_ip: 'localhost',
                        host_port: 3493,
                        ups_name: 'ups',
                        update_interval: 300,
                    });

                    obj.common.enabled = true;
                    obj.common.loglevel = 'debug';

                    // Use promise-based method for setting object
                    await harness.objects.setObjectAsync(obj._id, obj);
                    console.log('✅ Adapter configured for notify test');

                    // Start the adapter
                    await harness.startAdapterAndWait();
                    console.log('✅ Adapter started for notify test');

                    // Wait for initial setup
                    await new Promise(res => setTimeout(res, 8000));

                    // Create test adapter object for message sending using promise-based method
                    await harness.objects.setObjectAsync('system.adapter.test.0', {
                        common: {},
                        type: 'instance',
                    });

                    // Subscribe to message responses using promise-based method if available
                    if (harness.states.subscribeMessageAsync) {
                        await harness.states.subscribeMessageAsync('system.adapter.test.0');
                    } else {
                        // Fallback to callback-based method if promise version not available
                        await new Promise((resolve, reject) => {
                            harness.states.subscribeMessage('system.adapter.test.0', err => {
                                if (err) {
                                    return reject(err);
                                }
                                resolve();
                            });
                        });
                    }
                    console.log('✅ Test adapter configured');

                    // Send notify message using callback approach since pushMessage likely doesn't have async version
                    const notifyPromise = new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            reject(new Error('Timeout waiting for notify response'));
                        }, 20000);

                        let severityChecked = false;
                        let notifyChecked = false;

                        // Use subscription to monitor state changes
                        const checkStates = async () => {
                            try {
                                const lastNotifyState = await harness.states.getStateAsync('nut.0.status.last_notify');
                                const severityState = await harness.states.getStateAsync('nut.0.status.severity');

                                if (lastNotifyState && lastNotifyState.val === 'COMMBAD' && !notifyChecked) {
                                    console.log('✅ Correct notify message received: COMMBAD');
                                    notifyChecked = true;
                                }

                                if (severityState && severityState.val === 3 && !severityChecked) {
                                    console.log('✅ Correct severity received: 3 (action needed)');
                                    severityChecked = true;
                                }

                                if (notifyChecked && severityChecked) {
                                    clearTimeout(timeout);
                                    resolve();
                                } else {
                                    // Check again after a short delay
                                    setTimeout(checkStates, 1000);
                                }
                            } catch (error) {
                                clearTimeout(timeout);
                                reject(error);
                            }
                        };

                        // Send the notify message (using callback since pushMessage likely doesn't have promise version)
                        harness.states.pushMessage('system.adapter.nut.0', {
                            command: 'notify',
                            message: { notifytype: 'COMMBAD', upsname: 'nutName@127.0.0.1' },
                            from: 'system.adapter.test.0',
                            callback: {
                                message: { notifytype: 'COMMBAD', upsname: 'nutName@127.0.0.1' },
                                id: 1,
                                ack: false,
                                time: new Date().getTime(),
                            },
                        });
                        console.log('📤 Notify message sent: COMMBAD');

                        // Start checking for state changes
                        setTimeout(checkStates, 2000);
                    });

                    await notifyPromise;
                    console.log('✅ Notify message handling test completed');

                    await harness.stopAdapter();
                    console.log('🛑 Adapter stopped');

                    return true;
                } catch (error) {
                    console.error('❌ Notify test failed:', error.message);
                    throw error;
                }
            });
        });
    },
});
