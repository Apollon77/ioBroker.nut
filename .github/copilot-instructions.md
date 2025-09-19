# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

This is the **ioBroker NUT adapter** - a Network UPS Tools (NUT) adapter that connects to NUT servers to monitor Uninterruptible Power Supply (UPS) devices. The adapter:
- Connects to NUT servers running on network devices
- Monitors UPS status, battery levels, power conditions, and device parameters  
- Provides real-time status information including severity levels (idle, operating, operating_critical, action_needed, unknown)
- Supports UPS command execution (when permitted by NUT server configuration)
- Handles connection state management and automatic reconnection
- Uses the `node-nut` library for NUT protocol communication
- Key NUT-specific variables: `battery.charge`, `ups.status`, `input.voltage`, `output.voltage`, `ups.load`

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', () => new Promise(async (resolve) => {
                // Get adapter object and configure
                harness.objects.getObject('system.adapter.brightsky.0', async (err, obj) => {
                    if (err) {
                        console.error('Error getting adapter object:', err);
                        resolve();
                        return;
                    }

                    // Configure adapter
                    obj.native.apiKey = 'test-api-key';
                    obj.native.latitude = '52.520008';
                    obj.native.longitude = '13.404954';
                    harness.objects.setObject(obj._id, obj);

                    await harness.startAdapterAndWait();

                    setTimeout(() => {
                        harness.states.getState('brightsky.0.info.connection', (err, state) => {
                            if (err) {
                                console.error('Error getting connection state:', err);
                            } else if (state) {
                                console.log('Connection state:', state.val);
                            }
                            resolve();
                        });
                    }, 5000);
                });
            }));
        });
    }
});
```

#### Testing Without Live Connection

For adapters that require external service connections (like API endpoints or physical devices), always provide a testing strategy that works without live connections:

```javascript
it('should handle connection failure gracefully', () => new Promise(async (resolve, reject) => {
    try {
        // Configure adapter with invalid/unreachable connection info
        harness.objects.getObject('system.adapter.ADAPTERNAME.0', async (err, obj) => {
            if (err) {
                console.error('Error getting adapter object:', err);
                reject(err);
                return;
            }

            // Set configuration that will fail to connect
            obj.native.host = 'invalid-host';
            obj.native.port = 9999;
            harness.objects.setObject(obj._id, obj);

            await harness.startAdapterAndWait();

            // Check that adapter properly handles connection failure
            setTimeout(() => {
                harness.states.getState('ADAPTERNAME.0.info.connection', (err, state) => {
                    if (err) {
                        console.error('❌ Error getting connection state:', err);
                        reject(err);
                        return;
                    }

                    if (!state || state.val === false) {
                        console.log('✅ Adapter properly failed with missing required configuration');
                    } else {
                        console.log('❌ Adapter should have failed but connection shows true');
                    }
                    resolve();
                });
            }, 10000);
        } catch (error) {
            console.log('✅ Adapter correctly threw error with missing configuration:', error.message);
            resolve();
        }
    });
})).timeout(30000);
```

#### Advanced State Access Patterns

For testing adapters that create multiple states, use bulk state access methods to efficiently verify large numbers of states:

```javascript
it('should create and verify multiple states', () => new Promise(async (resolve, reject) => {
    // Configure and start adapter first...
    harness.objects.getObject('system.adapter.tagesschau.0', async (err, obj) => {
        if (err) {
            console.error('Error getting adapter object:', err);
            reject(err);
            return;
        }

        // Configure adapter as needed
        obj.native.someConfig = 'test-value';
        harness.objects.setObject(obj._id, obj);

        await harness.startAdapterAndWait();

        // Wait for adapter to create states
        setTimeout(() => {
            // Access bulk states using pattern matching
            harness.dbConnection.getStateIDs('tagesschau.0.*').then(stateIds => {
                if (stateIds && stateIds.length > 0) {
                    harness.states.getStates(stateIds, (err, allStates) => {
                        if (err) {
                            console.error('❌ Error getting states:', err);
                            reject(err); // Properly fail the test instead of just resolving
                            return;
                        }

                        // Verify states were created and have expected values
                        const expectedStates = ['tagesschau.0.info.connection', 'tagesschau.0.articles.0.title'];
                        let foundStates = 0;
                        
                        for (const stateId of expectedStates) {
                            if (allStates[stateId]) {
                                foundStates++;
                                console.log(`✅ Found expected state: ${stateId}`);
                            } else {
                                console.log(`❌ Missing expected state: ${stateId}`);
                            }
                        }

                        if (foundStates === expectedStates.length) {
                            console.log('✅ All expected states were created successfully');
                            resolve();
                        } else {
                            reject(new Error(`Only ${foundStates}/${expectedStates.length} expected states were found`));
                        }
                    });
                } else {
                    reject(new Error('No states found matching pattern tagesschau.0.*'));
                }
            }).catch(reject);
        }, 20000); // Allow more time for multiple state creation
    });
})).timeout(45000);
```

#### Key Integration Testing Rules

1. **NEVER test API URLs directly** - Let the adapter handle API calls
2. **ALWAYS use the harness** - `getHarness()` provides the testing environment  
3. **Configure via objects** - Use `harness.objects.setObject()` to set adapter configuration
4. **Start properly** - Use `harness.startAdapterAndWait()` to start the adapter
5. **Check states** - Use `harness.states.getState()` to verify results
6. **Use timeouts** - Allow time for async operations with appropriate timeouts
7. **Test real workflow** - Initialize → Configure → Start → Verify States

#### Workflow Dependencies
Integration tests should run ONLY after lint and adapter tests pass:

```yaml
integration-tests:
  needs: [check-and-lint, adapter-tests]
  runs-on: ubuntu-latest
  steps:
    - name: Run integration tests
      run: npx mocha test/integration-*.js --exit
```

#### What NOT to Do
❌ Direct API testing: `axios.get('https://api.example.com')`
❌ Starting adapter without harness: `new Adapter({})`
❌ Direct state access: `adapter.getState()`
❌ Fixed timeouts: Always allow enough time for operations
❌ Missing error handling: Always check for errors in callbacks

### NUT/UPS Adapter Specific Testing Patterns

For the NUT adapter, create tests that verify UPS monitoring functionality without requiring actual UPS hardware:

```javascript
// Test NUT connection handling
it('should handle NUT server connection properly', () => new Promise(async (resolve) => {
    harness.objects.getObject('system.adapter.nut.0', async (err, obj) => {
        if (err) {
            console.error('Error getting adapter object:', err);
            resolve();
            return;
        }

        // Configure with test NUT server settings
        obj.native.nut_host = '127.0.0.1';
        obj.native.nut_port = 3493;
        obj.native.ups_name = 'test-ups';
        obj.native.update_interval = 10;
        harness.objects.setObject(obj._id, obj);

        await harness.startAdapterAndWait();

        // Check that adapter creates expected UPS state structure
        setTimeout(() => {
            const expectedStates = [
                'nut.0.info.connection',
                'nut.0.status.severity',
                'nut.0.status.last_notify'
            ];
            
            harness.states.getStates(expectedStates, (err, states) => {
                if (err) {
                    console.error('Error getting states:', err);
                } else {
                    console.log('NUT adapter states created successfully');
                }
                resolve();
            });
        }, 15000);
    });
})).timeout(30000);
```

## API Integration Patterns

### Error Handling
For adapters that connect to external services, implement comprehensive error handling:

```javascript
// For network/API based adapters
function connectToService() {
    try {
        // Connection logic
    } catch (error) {
        adapter.log.error(`Connection failed: ${error.message}`);
        adapter.setState('info.connection', false, true);
        
        // Schedule retry
        setTimeout(() => {
            connectToService();
        }, adapter.config.retryInterval * 1000);
    }
}
```

### Connection State Management
Always maintain connection state for adapters that depend on external services:

```javascript
function setConnected(isConnected) {
    if (connected !== isConnected) {
        connected = isConnected;
        adapter.setState('info.connection', connected, true, (err) => {
            if (err) {
                adapter.log.error('Cannot update connected state: ' + err);
            } else {
                adapter.log.debug('connected set to ' + connected);
            }
        });
    }
}
```

### NUT-Specific Connection Patterns

For NUT server communication, implement proper connection management and error handling:

```javascript
// NUT connection initialization with retry logic
function initNutConnection(callback) {
    const nutHost = adapter.config.nut_host || 'localhost';
    const nutPort = parseInt(adapter.config.nut_port) || 3493;
    const upsName = adapter.config.ups_name;
    
    if (!nutHost || !nutPort || !upsName) {
        adapter.log.error('NUT configuration incomplete - missing host, port, or UPS name');
        if (callback) callback(null);
        return;
    }
    
    try {
        const nut = new Nut(nutPort, nutHost);
        
        nut.on('ready', () => {
            adapter.log.debug('NUT connection established');
            setConnected(true);
            if (callback) callback(nut);
        });
        
        nut.on('error', (err) => {
            adapter.log.error('NUT connection error: ' + err.message);
            setConnected(false);
            if (callback) callback(null);
        });
        
        nut.start();
        
    } catch (error) {
        adapter.log.error('Failed to create NUT connection: ' + error.message);
        setConnected(false);
        if (callback) callback(null);
    }
}

// UPS variable processing with proper type handling
function processUpsVar(varName, value) {
    // Convert NUT variable names to ioBroker state names
    const stateMap = {
        'battery.charge': { name: 'battery.charge', type: 'number', unit: '%' },
        'battery.voltage': { name: 'battery.voltage', type: 'number', unit: 'V' },
        'input.voltage': { name: 'input.voltage', type: 'number', unit: 'V' },
        'output.voltage': { name: 'output.voltage', type: 'number', unit: 'V' },
        'ups.load': { name: 'ups.load', type: 'number', unit: '%' },
        'ups.status': { name: 'ups.status', type: 'string' },
        'ups.temperature': { name: 'ups.temperature', type: 'number', unit: '°C' }
    };
    
    const stateConfig = stateMap[varName];
    if (!stateConfig) {
        // Handle unknown variables
        adapter.log.debug(`Unknown UPS variable: ${varName}`);
        return;
    }
    
    // Convert value to proper type
    let convertedValue = value;
    if (stateConfig.type === 'number') {
        convertedValue = parseFloat(value);
        if (isNaN(convertedValue)) {
            adapter.log.warn(`Invalid numeric value for ${varName}: ${value}`);
            return;
        }
    }
    
    // Create state object if it doesn't exist
    adapter.setObjectNotExists(stateConfig.name, {
        type: 'state',
        common: {
            name: stateConfig.name,
            type: stateConfig.type,
            role: stateConfig.type === 'number' ? 'value' : 'text',
            read: true,
            write: false,
            unit: stateConfig.unit
        },
        native: { id: varName }
    });
    
    // Set the state value
    adapter.setState(stateConfig.name, convertedValue, true);
}
```

## Adapter Lifecycle Management

### Initialization
```javascript
function main() {
    // Set initial connection state
    setConnected(false);
    
    // Ensure adapter runs in daemon mode
    adapter.getForeignObject('system.adapter.' + adapter.namespace, (err, obj) => {
       if (!err && obj && (obj.common.mode !== 'daemon')) {
            obj.common.mode = 'daemon';
            if (obj.common.schedule) delete(obj.common.schedule);
            adapter.setForeignObject(obj._id, obj);
       }
    });
    
    // Initialize adapter-specific functionality
    initializeAdapter();
}
```

### Graceful Shutdown
```javascript
adapter.on('unload', (callback) => {
    try {
        // Clean up timers
        if (updateTimeout) {
            clearTimeout(updateTimeout);
            updateTimeout = null;
        }
        
        // Close connections
        if (connectionHandle) {
            connectionHandle.close();
        }
        
        // Set disconnected state
        setConnected(false);
        
        callback();
    } catch (e) {
        callback();
    }
});
```

### NUT-Specific Lifecycle Management

```javascript
// NUT adapter initialization with connection delay for unreachable UPS
function initializeNutDevice() {
    const updateInterval = parseInt(adapter.config.update_interval, 10) || 60;
    
    initNutConnection((oNut) => {
        if (!oNut) {
            adapter.log.error('UPS not available - Delay initialization');
            nutTimeout = setTimeout(initializeNutDevice, updateInterval * 1000);
            return;
        }
        
        // Get UPS commands list for command state creation
        oNut.GetUPSCommands(adapter.config.ups_name, (cmdlist, err) => {
            if (err) {
                adapter.log.error('Error getting UPS commands: ' + err);
            } else if (cmdlist && Array.isArray(cmdlist)) {
                createCommandStates(cmdlist);
            }
            
            // Start regular UPS monitoring
            startUpsMonitoring(oNut);
        });
    });
}

// UPS command state creation
function createCommandStates(commands) {
    adapter.setObjectNotExists('commands', {
        type: 'channel',
        common: { name: 'Commands' },
        native: {}
    });
    
    commands.forEach(cmd => {
        const cmdId = cmd.replace(/\./g, '-');
        adapter.setObjectNotExists(`commands.${cmdId}`, {
            type: 'state',
            common: {
                name: cmd,
                type: 'boolean',
                role: 'button',
                read: false,
                write: true
            },
            native: { command: cmd }
        });
    });
}
```

## State Management

### Creating Objects
Always create objects before setting states:

```javascript
// Create channel first
await adapter.setObjectNotExistsAsync('deviceId', {
    type: 'channel',
    common: { name: 'Device Name' },
    native: {}
});

// Then create states
await adapter.setObjectNotExistsAsync('deviceId.property', {
    type: 'state',
    common: {
        name: 'Property Name',
        type: 'number',
        role: 'value',
        read: true,
        write: false,
        unit: 'unit'
    },
    native: {}
});
```

### State Updates
Use proper acknowledgment flags:

```javascript
// For data received from external source (acknowledged)
adapter.setState('deviceId.property', value, true);

// For user input or commands (not acknowledged)
adapter.setState('deviceId.command', value, false);
```

### NUT-Specific State Management

```javascript
// UPS status severity calculation based on NUT status
async function parseAndSetSeverity(status, force = false) {
    let severity = 4; // unknown
    
    if (status) {
        const statusLower = status.toLowerCase();
        if (statusLower.includes('ol')) { // On Line
            severity = 0; // idle
        } else if (statusLower.includes('ob')) { // On Battery
            if (statusLower.includes('lb')) { // Low Battery
                severity = 3; // action_needed
            } else {
                severity = 2; // operating_critical
            }
        } else if (statusLower.includes('chrg')) { // Charging
            severity = 1; // operating
        }
    }
    
    try {
        await adapter.setStateAsync('status.severity', { ack: true, val: severity });
        adapter.log.debug(`UPS severity set to: ${severity} (${status})`);
    } catch (err) {
        adapter.log.error('Error setting severity: ' + err);
    }
}

// UPS variable state creation with proper type mapping
function createUpsVariableState(varName, value) {
    const stateId = varName.replace(/\./g, '_');
    
    // Determine state type based on variable name and value
    let stateType = 'string';
    let stateRole = 'text';
    let stateUnit;
    
    if (/^(battery\.charge|ups\.load|input\.voltage|output\.voltage|battery\.voltage)/.test(varName)) {
        stateType = 'number';
        stateRole = 'value';
        
        if (varName.includes('charge') || varName.includes('load')) {
            stateUnit = '%';
        } else if (varName.includes('voltage')) {
            stateUnit = 'V';
        }
    }
    
    adapter.setObjectNotExists(stateId, {
        type: 'state',
        common: {
            name: varName,
            type: stateType,
            role: stateRole,
            read: true,
            write: false,
            unit: stateUnit
        },
        native: { nutVariable: varName }
    });
    
    // Convert and set value
    let convertedValue = value;
    if (stateType === 'number') {
        convertedValue = parseFloat(value);
        if (isNaN(convertedValue)) {
            adapter.log.warn(`Invalid number value for ${varName}: ${value}`);
            return;
        }
    }
    
    adapter.setState(stateId, convertedValue, true);
}
```

## Configuration Validation

### Validating Required Fields
```javascript
function validateConfig() {
    const config = adapter.config;
    
    if (!config.requiredField) {
        adapter.log.error('Required field "requiredField" is missing in configuration');
        return false;
    }
    
    if (config.numericField && isNaN(parseInt(config.numericField))) {
        adapter.log.error('Field "numericField" must be a valid number');
        return false;
    }
    
    return true;
}
```

### NUT Configuration Validation

```javascript
function validateNutConfig() {
    const config = adapter.config;
    
    // Check required NUT server settings
    if (!config.nut_host) {
        adapter.log.error('NUT host is required');
        return false;
    }
    
    const port = parseInt(config.nut_port);
    if (!port || port < 1 || port > 65535) {
        adapter.log.error('NUT port must be a valid port number (1-65535)');
        return false;
    }
    
    if (!config.ups_name) {
        adapter.log.error('UPS name is required');
        return false;
    }
    
    // Validate update interval
    const interval = parseInt(config.update_interval);
    if (!interval || interval < 10) {
        adapter.log.warn('Update interval too low, setting to 60 seconds');
        config.update_interval = 60;
    }
    
    return true;
}
```

## Async/Await Patterns

### Modern Async Patterns
Prefer async/await over callbacks for new code:

```javascript
async function processData() {
    try {
        const data = await fetchExternalData();
        await updateStates(data);
        adapter.log.info('Data processed successfully');
    } catch (error) {
        adapter.log.error('Error processing data: ' + error.message);
    }
}
```

### Converting Callbacks
When working with callback-based APIs:

```javascript
function promisifyCallback(callbackFunction, ...args) {
    return new Promise((resolve, reject) => {
        callbackFunction(...args, (error, result) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    });
}

// Usage
try {
    const result = await promisifyCallback(adapter.getState, 'some.state');
} catch (error) {
    adapter.log.error('Error getting state: ' + error.message);
}
```

## Code Style

### ES6+ Features
- Use `const` and `let` instead of `var`
- Use arrow functions for short functions
- Use template literals for string interpolation
- Use destructuring for object/array access

```javascript
// Good
const { config } = adapter;
const message = `Connecting to ${config.host}:${config.port}`;
const processResult = (result) => adapter.log.info(`Result: ${result}`);

// Avoid
var config = adapter.config;
var message = 'Connecting to ' + config.host + ':' + config.port;
function processResult(result) {
    adapter.log.info('Result: ' + result);
}
```

### Error Handling
Always handle errors appropriately:

```javascript
// For API calls
try {
    const response = await api.getData();
    processResponse(response);
} catch (error) {
    adapter.log.error(`API call failed: ${error.message}`);
    setConnected(false);
}

// For adapter operations
adapter.getState('some.state', (err, state) => {
    if (err) {
        adapter.log.error(`Cannot get state: ${err.message}`);
        return;
    }
    
    if (state) {
        processState(state.val);
    }
});
```

## Documentation

### JSDoc Comments
Use JSDoc for function documentation:

```javascript
/**
 * Processes UPS data and updates ioBroker states
 * @param {Object} upsData - Raw UPS data from NUT server
 * @param {string} upsData.status - UPS status string
 * @param {number} upsData.batteryCharge - Battery charge percentage
 * @returns {Promise<void>}
 */
async function processUpsData(upsData) {
    // Implementation
}
```

### README Updates
Keep README.md current with:
- Clear description of adapter functionality
- Configuration instructions
- Supported devices/services
- Troubleshooting information
- Changelog entries

## Security Considerations

### Sensitive Data
- Never log passwords or API keys
- Store sensitive configuration in `native` object
- Use encryption for stored credentials when needed

```javascript
// Good
adapter.log.debug(`Connecting to ${config.host}`);

// Bad
adapter.log.debug(`Connecting with credentials: ${config.password}`);
```

### Input Validation
Always validate and sanitize external input:

```javascript
function sanitizeInput(input) {
    if (typeof input !== 'string') {
        return '';
    }
    
    return input.trim().slice(0, 255); // Limit length and trim
}
```

## Performance Considerations

### Efficient Polling
For adapters that poll external services:

```javascript
let pollTimeout;

function startPolling() {
    async function poll() {
        try {
            await fetchAndUpdateData();
        } catch (error) {
            adapter.log.error(`Polling error: ${error.message}`);
        }
        
        // Schedule next poll
        pollTimeout = setTimeout(poll, adapter.config.pollInterval * 1000);
    }
    
    poll();
}

function stopPolling() {
    if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
    }
}
```

### Memory Management
- Clear timeouts and intervals on adapter unload
- Remove event listeners when done
- Avoid memory leaks in long-running operations

```javascript
adapter.on('unload', () => {
    stopPolling();
    // Clean up other resources
});
```