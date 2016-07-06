var Nut = require('node-nut');

//oNut = new Nut(3493, 'localhost');
oNut = new Nut(3493, '192.168.178.23');

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
