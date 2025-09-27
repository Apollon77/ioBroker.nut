const path = require('path');
const { tests } = require('@iobroker/testing');

// Run integration tests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test NUT adapter integration', getHarness => {
            it('should start and create connection state', async function () {
                const harness = getHarness();
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
        });
    },
});
