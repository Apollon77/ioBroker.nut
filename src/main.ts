/**
 *
 * NUT adapter
 *
 * Adapter loading NUT data from an UPS
 *
 */

import * as utils from '@iobroker/adapter-core';
// @ts-expect-error no types available
import Nut from 'node-nut';

// Extend the AdapterConfig type to include custom settings
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace ioBroker {
        interface AdapterConfig {
            host_ip: string;
            host_port: string | number;
            ups_name: string;
            update_interval: string | number;
            username: string;
            password: string;
        }
    }
}

class NutAdapter extends utils.Adapter {
    #nutTimeout: ioBroker.Timeout | null | undefined = null;
    #stopInProgress = false;
    #nutConnected: boolean | null = null;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'nut',
        });

        this.on('ready', this.#onReady.bind(this));
        this.on('stateChange', this.#onStateChange.bind(this));
        this.on('message', this.#onMessage.bind(this));
        this.on('unload', this.#onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async #onReady(): Promise<void> {
        this.#setConnected(false);

        void this.getForeignObject(`system.adapter.${this.namespace}`, (err, obj) => {
            if (!err && obj && obj.common.mode !== 'daemon') {
                obj.common.mode = 'daemon';
                if (obj.common.schedule) {
                    delete obj.common.schedule;
                }
                void this.setForeignObject(obj._id, obj);
            }
        });

        this.log.debug('Create Channel status');
        try {
            await this.setObjectNotExistsAsync('status', {
                type: 'channel',
                common: { name: 'status' },
                native: {},
            });
        } catch (err: unknown) {
            this.log.error(`Error creating Channel: ${err instanceof Error ? err.message : String(err)}`);
        }
        try {
            await this.setObjectNotExistsAsync('status.severity', {
                type: 'state',
                common: {
                    name: 'status.severity',
                    role: 'indicator',
                    type: 'number',
                    read: true,
                    write: false,
                    def: 4,
                    states: { 0: 'idle', 1: 'operating', 2: 'operating_critical', 3: 'action_needed', 4: 'unknown' },
                },
                native: { id: 'status.severity' },
            });
        } catch (err: unknown) {
            this.log.error(`Error creating State: ${err instanceof Error ? err.message : String(err)}`);
        }
        await this.#parseAndSetSeverity('', true);
        try {
            await this.setObjectNotExistsAsync('status.last_notify', {
                type: 'state',
                common: {
                    name: 'status.last_notify',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false,
                },
                native: {
                    id: 'status.last_notify',
                },
            });
        } catch (err: unknown) {
            this.log.error(`Error creating State: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.getState('status.last_notify', async (err, state) => {
            if (!err && !state) {
                await this.setStateAsync('status.last_notify', { ack: true, val: '' });
            }
            this.#initializeNutDevice();
        });
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - callback function
     */
    #onUnload(callback: () => void): void {
        try {
            this.#stopInProgress = true;
            if (this.#nutTimeout) {
                this.clearTimeout(this.#nutTimeout);
            }
            this.#nutTimeout = null;
            this.#setConnected(false);
        } catch {
            // ignore
        } finally {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     *
     * @param id - state ID
     * @param state - state object
     */
    #onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (state) {
            this.log.debug(`stateChange ${id} ${JSON.stringify(state)}`);
            const realNamespace = `${this.namespace}.commands.`;
            const stateId = id.substring(realNamespace.length);
            if (state.ack || id.indexOf(realNamespace) !== 0) {
                return;
            }

            const command = stateId.replace(/-/g, '.');
            this.#initNutConnection(oNut => {
                if (!oNut) {
                    this.log.error(`USV not available - Error while sending command: ${command}`);
                    return;
                }
                if (this.#stopInProgress) {
                    return;
                } // adapter already unloaded
                if (this.config.username && this.config.password) {
                    this.log.info(`send username for command ${command}`);
                    oNut.SetUsername(this.config.username, (err: any) => {
                        if (err) {
                            this.log.error(`Err while sending username: ${err}`);
                            oNut.close();
                        } else {
                            this.log.info(`send password for command ${command}`);
                            oNut.SetPassword(this.config.password, (err: any) => {
                                if (err) {
                                    this.log.error(`Err while sending password: ${err}`);
                                    oNut.close();
                                } else {
                                    this.log.info(`send command ${command}`);
                                    oNut.RunUPSCommand(this.config.ups_name, command, (err: any) => {
                                        if (err) {
                                            this.log.error(`Err while sending command ${command}: ${err}`);
                                            oNut.close();
                                        }
                                        this.#getCurrentNutValues(oNut, true);
                                    });
                                }
                            });
                        }
                    });
                } else {
                    this.log.info(`send command ${command} without username and password`);
                    oNut.RunUPSCommand(this.config.ups_name, command, (err: any) => {
                        if (err) {
                            this.log.error(`Err while sending command ${command}: ${err}`);
                        }
                        this.#getCurrentNutValues(oNut, true);
                    });
                }

                void this.setState(id, { ack: true, val: false });
            });
        }
    }

    /**
     * Some message was sent to this instance over message box.
     *
     * @param obj - message object
     */
    #onMessage(obj: ioBroker.Message): void {
        if (!obj) {
            return;
        }

        this.log.info(`Message received = ${JSON.stringify(obj)}`);

        let updateNut = false;
        if (obj.command === 'notify' && obj.message) {
            const msg = obj.message;
            this.log.info(`got Notify ${msg.notifytype} for: ${msg.upsname}`);
            const ownName = `${this.config.ups_name}@${this.config.host_ip}`;
            this.log.info(`ownName=${ownName} --> ${ownName === msg.upsname}`);
            if (ownName === msg.upsname) {
                updateNut = true;
                void this.setState('status.last_notify', { ack: true, val: msg.notifytype });
                if (msg.notifytype === 'COMMBAD' || msg.notifytype === 'NOCOMM') {
                    void this.#parseAndSetSeverity('OFF');
                }
            }
        } else {
            updateNut = true;
        }

        if (updateNut) {
            if (this.#nutTimeout) {
                this.clearTimeout(this.#nutTimeout);
            }
            this.#updateNutData();
        }
    }

    #setConnected(isConnected: boolean): void {
        if (this.#nutConnected !== isConnected) {
            this.#nutConnected = isConnected;
            void this.setState('info.connection', this.#nutConnected, true, err => {
                // analyse if the state could be set (because of permissions)
                if (err) {
                    this.log.error(`Can not update connected state: ${String(err)}`);
                } else {
                    this.log.debug(`connected set to ${this.#nutConnected}`);
                }
            });
        }
    }

    #initializeNutDevice(): void {
        const update_interval = parseInt(String(this.config.update_interval), 10) || 60;

        this.#initNutConnection(oNut => {
            if (!oNut) {
                this.log.error('USV not available - Delay initialization');

                this.#nutTimeout = this.setTimeout(() => this.#initializeNutDevice(), update_interval * 1000);

                return;
            }
            oNut.GetUPSCommands(this.config.ups_name, (cmdlist: string[], err: any) => {
                if (err) {
                    this.log.error(`Err while getting all commands: ${err}`);
                } else {
                    this.log.debug('Got commands, create and subscribe command states');
                    void this.#initNutCommands(cmdlist);
                }

                this.#getCurrentNutValues(oNut, true);

                this.#nutTimeout = this.setTimeout(() => this.#updateNutData(), update_interval * 1000);
            });
        });
    }

    async #initNutCommands(cmdlist: string[]): Promise<void> {
        this.log.debug('Create Channel commands');
        try {
            await this.setObjectNotExistsAsync('commands', {
                type: 'channel',
                common: { name: 'commands' },
                native: {},
            });
        } catch (err: unknown) {
            this.log.error(`Error creating Channel: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (!cmdlist) {
            return;
        }

        for (let i = 0; i < cmdlist.length; i++) {
            const cmdName = cmdlist[i].replace(/\./g, '-');
            this.log.debug(`Create State commands.${cmdName}`);
            try {
                await this.setObjectNotExistsAsync(`commands.${cmdName}`, {
                    type: 'state',
                    common: {
                        name: `commands.${cmdName}`,
                        role: 'button',
                        type: 'boolean',
                        read: true,
                        write: true,
                        def: false,
                    },
                    native: { id: `commands.${cmdName}` },
                });
            } catch (err: unknown) {
                this.log.error(`Error creating State: ${err instanceof Error ? err.message : String(err)}`);
            }
            await this.setStateAsync(`commands.${cmdName}`, { ack: true, val: false });
        }
        this.subscribeStates('commands.*');
    }

    #initNutConnection(callback: (oNut: any) => void): void {
        const host_port = parseInt(String(this.config.host_port), 10);
        if (host_port < 0 || host_port > 65535 || isNaN(host_port)) {
            this.log.error(`Configured Port invalid: ${this.config.host_port}`);
            this.terminate
                ? this.terminate(utils.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                : process.exit(utils.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
            return;
        }

        const oNut = new Nut(host_port, this.config.host_ip);

        oNut.on('error', (err: any) => {
            if (this.#stopInProgress) {
                return;
            } // adapter already unloaded
            this.log.error(`Error happened: ${err}`);
            this.#setConnected(false);
            this.getState('status.last_notify', (err, state) => {
                if (
                    (!err && !state) ||
                    (state && state.val !== 'COMMBAD' && state.val !== 'SHUTDOWN' && state.val !== 'NOCOMM')
                ) {
                    void this.setState('status.last_notify', { ack: true, val: 'ERROR' });
                }
                if (!err) {
                    void this.#parseAndSetSeverity('');
                }
                callback(null);
            });
        });

        oNut.on('close', () => {
            this.log.debug('NUT Connection closed. Done.');
        });

        oNut.on('ready', () => {
            this.log.debug('NUT Connection ready');
            this.#setConnected(true);
            callback(oNut);
        });

        oNut.start();
    }

    #updateNutData(): void {
        this.log.debug('Start NUT update');

        this.#initNutConnection(oNut => {
            oNut && this.#getCurrentNutValues(oNut, true);
        });

        const update_interval = parseInt(String(this.config.update_interval), 10) || 60;
        this.#nutTimeout = this.setTimeout(() => this.#updateNutData(), update_interval * 1000);
    }

    #getCurrentNutValues(oNut: any, closeConnection: boolean): void {
        oNut.GetUPSVars(this.config.ups_name, (varlist: Record<string, any>, err: any) => {
            if (err) {
                this.log.error(`Err while getting NUT values: ${err}`);
            } else {
                this.log.debug('Got values, start setting them');
                void this.#storeNutData(varlist);
            }
            if (closeConnection) {
                oNut.close();
            }
        });
    }

    async #storeNutData(varlist: Record<string, any>): Promise<void> {
        let last = '';
        let current = '';
        let index = 0;
        let stateName = '';

        for (const key in varlist) {
            if (!Object.prototype.hasOwnProperty.call(varlist, key)) {
                continue;
            }

            index = key.indexOf('.');
            if (index > 0) {
                current = key.substring(0, index);
            } else {
                current = '';
                last = '';
                index = -1;
            }
            if ((last === '' || last !== current) && current !== '') {
                this.log.debug(`Create Channel ${current}`);
                try {
                    await this.setObjectNotExistsAsync(current, {
                        type: 'channel',
                        common: {
                            name: current,
                        },
                        native: {},
                    });
                } catch (err: unknown) {
                    this.log.error(`Error creating Channel: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            stateName = `${current}.${key.substring(index + 1).replace(/\./g, '-')}`;
            this.log.debug(`Create State ${stateName}`);
            if (stateName === 'battery.charge') {
                try {
                    // it has type string but should be an integer
                    varlist[key] = parseInt(varlist[key]);
                    await this.setObjectNotExistsAsync(stateName, {
                        type: 'state',
                        common: {
                            name: stateName,
                            type: 'number',
                            role: 'value.battery',
                            read: true,
                            write: false,
                            unit: '%',
                        },
                        native: { id: stateName },
                    });
                } catch (err: unknown) {
                    this.log.error(`Error creating State: ${err instanceof Error ? err.message : String(err)}`);
                }
            } else {
                try {
                    await this.setObjectNotExistsAsync(stateName, {
                        type: 'state',
                        common: { name: stateName, type: 'string', role: 'state', read: true, write: false },
                        native: { id: stateName },
                    });
                } catch (err: unknown) {
                    this.log.error(`Error creating State: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            this.log.debug(`Set State ${stateName} = ${varlist[key]}`);
            await this.setStateAsync(stateName, { ack: true, val: varlist[key] });
            last = current;
        }

        if (varlist['ups.status']) {
            await this.#parseAndSetSeverity(varlist['ups.status']);
        } else {
            await this.#parseAndSetSeverity('');
        }

        this.log.debug('All Nut values set');
    }

    async #parseAndSetSeverity(ups_status: string, createObjects?: boolean): Promise<void> {
        const statusMap: Record<string, { name: string; severity: string }> = {
            OL: { name: 'online', severity: 'idle' },
            OB: { name: 'onbattery', severity: 'operating' },
            LB: { name: 'lowbattery', severity: 'operating_critical' },
            HB: { name: 'highbattery', severity: 'operating_critical' },
            RB: { name: 'replacebattery', severity: 'action_needed' },
            CHRG: { name: 'charging', severity: 'idle' },
            DISCHRG: { name: 'discharging', severity: 'operating' },
            BYPASS: { name: 'bypass', severity: 'action_needed' },
            CAL: { name: 'calibration', severity: 'operating' },
            OFF: { name: 'offline', severity: 'action_needed' },
            OVER: { name: 'overload', severity: 'action_needed' },
            TRIM: { name: 'trimming', severity: 'operating' },
            BOOST: { name: 'boosting', severity: 'operating' },
            FSD: { name: 'shutdown', severity: 'operating_critical' },
        };
        const severity: Record<string, boolean> = {
            idle: false,
            operating: false,
            operating_critical: false,
            action_needed: false,
        };
        if (ups_status.indexOf('FSD') !== -1) {
            ups_status += ' OB LB';
        }
        const checker = ` ${ups_status} `;
        let stateName = '';
        for (const idx in statusMap) {
            if (Object.prototype.hasOwnProperty.call(statusMap, idx)) {
                const found = checker.indexOf(` ${idx}`) > -1;
                stateName = `status.${statusMap[idx].name}`;
                this.log.debug(`Create State ${stateName}`);
                try {
                    createObjects &&
                        (await this.setObjectNotExistsAsync(stateName, {
                            type: 'state',
                            common: { name: stateName, type: 'boolean', role: 'indicator', read: true, write: false },
                            native: { id: stateName },
                        }));
                } catch (err: unknown) {
                    this.log.error(`Error creating State: ${err instanceof Error ? err.message : String(err)}`);
                }
                this.log.debug(`Set State ${stateName} = ${found}`);
                await this.setStateAsync(stateName, { ack: true, val: found });
                if (found) {
                    severity[statusMap[idx].severity] = true;
                    this.log.debug(`Severity Flag ${statusMap[idx].severity}=true`);
                }
            }
        }
        let severityVal = 4;
        if (severity.operating_critical) {
            severityVal = 2;
        } else if (severity.action_needed) {
            severityVal = 3;
        } else if (severity.operating) {
            severityVal = 1;
        } else if (severity.idle) {
            severityVal = 0;
        }

        this.log.debug(`Set State status.severity = ${severityVal}`);
        await this.setStateAsync('status.severity', { ack: true, val: severityVal });
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new NutAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new NutAdapter())();
}
