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
                    console.log('✅ Adapter configuration updated');

                    // Start the adapter
                    await harness.startAdapterAndWait();
                    console.log('✅ Adapter started');

                    // Wait for adapter to initialize - NUT adapter needs time to attempt connection and fail
                    console.log('⏳ Waiting for adapter initialization...');
                    await new Promise(res => setTimeout(res, 15000));

                    // Check if connection state exists using promise-based method with assertions
                    const connectionState = await harness.states.getStateAsync('nut.0.info.connection');
                    expect(connectionState, 'Connection state should exist').to.not.be.null;
                    expect(connectionState.val, 'Connection should be false when no NUT server available').to.be.false;
                    console.log(`✅ Connection state verified: ${connectionState.val}`);

                    // Test initial state - We expect ERROR as last_notify because no NUT server is running
                    const lastNotifyState = await harness.states.getStateAsync('nut.0.status.last_notify');
                    expect(lastNotifyState, 'Last notify state should exist').to.not.be.null;
                    expect(lastNotifyState.val, 'Should show ERROR when no NUT server available').to.equal('ERROR');
                    console.log('✅ Correct initial notify state: ERROR (no NUT server available)');

                    const severityState = await harness.states.getStateAsync('nut.0.status.severity');
                    expect(severityState, 'Severity state should exist').to.not.be.null;
                    expect(severityState.val, 'Should show severity 4 (unknown) when no NUT server available').to.equal(
                        4,
                    );
                    console.log('✅ Correct initial severity: 4 (unknown - no NUT server available)');

                    // Check for other basic states that should be created
                    const stateIds = await harness.dbConnection.getStateIDs('nut.0.*');
                    expect(stateIds, 'Adapter should create states').to.be.an('array');
                    expect(stateIds.length, 'Should have created multiple states').to.be.greaterThan(0);
                    console.log(`📊 Found ${stateIds.length} states - ✅ Adapter successfully created states`);

                    await harness.stopAdapter();
                    console.log('🛑 Adapter stopped');
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
                                    expect(lastNotifyState.val, 'Notify message should be COMMBAD').to.equal('COMMBAD');
                                    console.log('✅ Correct notify message received: COMMBAD');
                                    notifyChecked = true;
                                }

                                if (severityState && severityState.val === 3 && !severityChecked) {
                                    expect(
                                        severityState.val,
                                        'Severity should be 3 (action needed) for COMMBAD',
                                    ).to.equal(3);
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
