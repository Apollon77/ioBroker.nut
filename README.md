![Logo](admin/nut.png)
# ioBroker.nut
===============
[![NPM version](http://img.shields.io/npm/v/iobroker.nut.svg)](https://www.npmjs.com/package/iobroker.nut)
[![Downloads](https://img.shields.io/npm/dm/iobroker.nut.svg)](https://www.npmjs.com/package/iobroker.nut)

[![NPM](https://nodei.co/npm/iobroker.nut.png?downloads=true)](https://nodei.co/npm/iobroker.nut/)

This adapter for iobroker connects to a defined NUT server to provide the status and details of a connected UPS/USV as ioBroker states, so that it can be used there.

## Description of parameters
### host_ip
IP address of the NUT server. NUT needs to run in server mode and needs to be accessible by the computer the
iobroker NUT adapter runs on. So check firewall settings if you have problems and allow the access. If the UPS
is connected locally you can also use 127.0.0.1 or localhost.

### host_port
Port of NUT. The default port is <b>3493</b>

### ups_name
Name of the UPS as defined in the NUT configuration of the NUT server.</p>
Hint: If you want to connect to an UPS connected to a Synology diskstation the name is simply "ups".

### Troubleshooting
If you have problems and the adapter do not deliver the data you can use the two scripts in directory "test"
of the adapter installation (so normally in node_modules/iobroker.nut/test relative to your iobroker installation
directory) to try it out on the commandline. Call the scripts using "node filename.js" to see the awaited parameters.</p>
* **test_upslist.js**: Connects to the NUT server and returns a list of available UPS names
* **test_upsvars.js**: Connects to the NUT server for a defined UPS and returns a list of available UPS variables


# changelog
## 0.1.0
initial release for testing

# Todo
* publish to npm and make available officially


# License

The MIT License (MIT)

Copyright (c) 2015-2016 Apollon77 <ingo@fischer-ka.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
