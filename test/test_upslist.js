if (process.argv.length<3) {
  console.log('Call: test_upsvars.js <ip> <port> <ups-name>');
  process.exit();
}

var Nut = require('node-nut');

//oNut = new Nut(3493, 'localhost');
oNut = new Nut(process.argv[3], process.argv[2]);

oNut.on('error', function(err) {
  console.log('There was an error: ' + err);
});

oNut.on('close', function() {
  console.log('Connection closed.');
});

oNut.on('ready', function() {
  self = this;
  this.GetUPSList(function(upslist) {
    console.log(upslist);
    self.close();
  });
});

oNut.start();
