/**
 * @class
 * @classdesc XMODEM Protocol in JavaScript
 * @name Xmodem
 * @license BSD-2-Clause
 */

 import EventEmitter from "events";
 import fs from "fs";
 import crc from "crc";

 class Xmodem extends EventEmitter {
   static XMODEM_START_BLOCK = 1;
   static XMODEM_MAX_TIMEOUTS = 5;
   static XMODEM_MAX_ERRORS = 10;
   static XMODEM_CRC_ATTEMPTS = 3;
   static XMODEM_OP_MODE = "crc";
   static timeout_seconds = 10;
   static block_size = 128;

   path: string;

   constructor(path: string) {
     super();
     this.path = path;
   }
   /**
    * Send a file using XMODEM protocol
    * @method
    * @name Xmodem#send
    * @param {socket} socket - net.Socket() or Serialport socket for transport
    * @param {buffer} dataBuffer - Buffer() to be sent
    */
   send(socket: any, dataBuffer: Buffer) {
     let blockNumber = Xmodem.XMODEM_START_BLOCK;
     const packagedBuffer = new Array();
     let current_block = Buffer.alloc(Xmodem.block_size);
     let sent_eof = false;
     const _self = this;

     this.log(dataBuffer.length);

     // FILLER
     for (let i = 0; i < Xmodem.XMODEM_START_BLOCK; i++) {
       packagedBuffer.push("");
     }

     while (dataBuffer.length > 0) {
       for (let i = 0; i < Xmodem.block_size; i++) {
         current_block[i] = dataBuffer[i] === undefined ? FILLER : dataBuffer[i];
       }
       dataBuffer = dataBuffer.slice(Xmodem.block_size);
       packagedBuffer.push(current_block);
       current_block = Buffer.alloc(Xmodem.block_size);
     }

     /**
      * Ready to send event, buffer has been broken into individual blocks to be sent.
      * @event Xmodem#ready
      * @property {integer} - Indicates how many blocks are ready for transmission
      */
     _self.emit("ready", packagedBuffer.length - 1); // We don't count the filler

     const sendData = function (data: any) {
       /*
        * Here we handle the beginning of the transmission
        * The receiver initiates the transfer by either calling
        * checksum mode or CRC mode.
        */
       if (data[0] === CRC_MODE && blockNumber === Xmodem.XMODEM_START_BLOCK) {
         log.info("[SEND] - received C byte for CRC transfer!");
         Xmodem.XMODEM_OP_MODE = "crc";
         if (packagedBuffer.length > blockNumber) {
           /**
            * Transmission Start event. A successful start of transmission.
            * @event Xmodem#start
            * @property {string} - Indicates transmission mode 'crc' or 'normal'
            */
           _self.emit("start", Xmodem.XMODEM_OP_MODE);
           sendBlock(
             socket,
             blockNumber,
             packagedBuffer[blockNumber],
             Xmodem.XMODEM_OP_MODE
           );
           _self.emit("status", {
             action: "send",
             signal: "SOH",
             block: blockNumber,
           });
           blockNumber++;
         }
       } else if (data[0] === NAK && blockNumber === Xmodem.XMODEM_START_BLOCK) {
         log.info("[SEND] - received NAK byte for standard checksum transfer!");
         Xmodem.XMODEM_OP_MODE = "normal";
         if (packagedBuffer.length > blockNumber) {
           _self.emit("start", Xmodem.XMODEM_OP_MODE);
           sendBlock(
             socket,
             blockNumber,
             packagedBuffer[blockNumber],
             Xmodem.XMODEM_OP_MODE
           );
           _self.emit("status", {
             action: "send",
             signal: "SOH",
             block: blockNumber,
           });
           blockNumber++;
         }
       } else if (data[0] === ACK && blockNumber > Xmodem.XMODEM_START_BLOCK) {
         /*
          * Here we handle the actual transmission of data and
          * retransmission in case the block was not accepted.
          */
         // Woohooo we are ready to send the next block! :)
         log.info("ACK RECEIVED");
         _self.emit("status", { action: "recv", signal: "ACK" });
         if (packagedBuffer.length > blockNumber) {
           sendBlock(
             socket,
             blockNumber,
             packagedBuffer[blockNumber],
             Xmodem.XMODEM_OP_MODE
           );
           _self.emit("status", {
             action: "send",
             signal: "SOH",
             block: blockNumber,
           });
           blockNumber++;
         } else if (packagedBuffer.length === blockNumber) {
           // We are EOT
           if (sent_eof === false) {
             sent_eof = true;
             log.info("WE HAVE RUN OUT OF STUFF TO SEND, EOT EOT!");
             _self.emit("status", { action: "send", signal: "EOT" });
             socket.write(Buffer.from([EOT]));
           } else {
             // We are finished!
             log.info("[SEND] - Finished!");
             _self.emit("stop", 0);
             socket.removeListener("data", sendData);
           }
         }
       } else if (data[0] === NAK && blockNumber > Xmodem.XMODEM_START_BLOCK) {
         if (blockNumber === packagedBuffer.length && sent_eof) {
           log.info(
             "[SEND] - Resending EOT, because receiver responded with NAK."
           );
           _self.emit("status", { action: "send", signal: "EOT" });
           socket.write(Buffer.from([EOT]));
         } else {
           log.info(
             "[SEND] - Packet corruption detected, resending previous block."
           );
           _self.emit("status", { action: "recv", signal: "NAK" });
           blockNumber--;
           if (packagedBuffer.length > blockNumber) {
             sendBlock(
               socket,
               blockNumber,
               packagedBuffer[blockNumber],
               Xmodem.XMODEM_OP_MODE
             );
             _self.emit("status", {
               action: "send",
               signal: "SOH",
               block: blockNumber,
             });
             blockNumber++;
           }
         }
       } else {
         log.warn("GOT SOME UNEXPECTED DATA which was not handled properly!");
         log.warn("===>");
         log.warn(data);
         log.warn("<===");
         log.warn("blockNumber: " + blockNumber);
       }
     };

     socket.on("data", sendData);
   }
   /**
    * Receive a file using XMODEM protocol
    * @method
    * @name Xmodem#receive
    * @param {socket} socket - net.Socket() or Serialport socket for transport
    * @param {string} filename - pathname where to save the transferred file
    */
   receive(socket: any, filename: string) {
     let blockNumber = Xmodem.XMODEM_START_BLOCK;
     const packagedBuffer = new Array();
     const nak_tick = Xmodem.XMODEM_MAX_ERRORS * Xmodem.timeout_seconds * 3;
     const crc_tick = Xmodem.XMODEM_CRC_ATTEMPTS;
     let transfer_initiated = false;
     let tryCounter = 0;
     const _self = this;

     // FILLER
     for (let i = 0; i < Xmodem.XMODEM_START_BLOCK; i++) {
       packagedBuffer.push("");
     }

     // Let's try to initate transfer with XMODEM-CRC
     if (Xmodem.XMODEM_OP_MODE === "crc") {
       log.info("CRC init sent");
       socket.write(Buffer.from([CRC_MODE]));
       receive_interval_timer = setIntervalX(
         function () {
           if (transfer_initiated === false) {
             log.info("CRC init sent");
             socket.write(Buffer.from([CRC_MODE]));
           } else {
             clearInterval(receive_interval_timer);
             receive_interval_timer = false;
           }
           // Fallback to standard XMODEM
           if (!receive_interval_timer && transfer_initiated === false) {
             receive_interval_timer = setIntervalX(
               function () {
                 log.info("NAK init sent");
                 socket.write(Buffer.from([NAK]));
                 Xmodem.XMODEM_OP_MODE = "normal";
               },
               3000,
               nak_tick
             );
           }
         },
         3000,
         crc_tick - 1
       );
     } else {
       receive_interval_timer = setIntervalX(
         function () {
           log.info("NAK init sent");
           socket.write(Buffer.from([NAK]));
           Xmodem.XMODEM_OP_MODE = "normal";
         },
         3000,
         nak_tick
       );
     }

     const receiveData = function (data: any) {
       tryCounter++;
       log.info("[RECV] - Received: " + data.toString("utf-8"));
       log.info(data);
       if (data[0] === NAK && blockNumber === Xmodem.XMODEM_START_BLOCK) {
         log.info("[RECV] - received NAK byte!");
       } else if (data[0] === SOH && tryCounter <= Xmodem.XMODEM_MAX_ERRORS) {
         if (transfer_initiated === false) {
           // Initial byte received
           transfer_initiated = true;
           clearInterval(receive_interval_timer);
           receive_interval_timer = false;
         }

         receiveBlock(
           socket,
           blockNumber,
           data,
           Xmodem.block_size,
           Xmodem.XMODEM_OP_MODE,
           function (current_block) {
             log.info(current_block);
             packagedBuffer.push(current_block);
             tryCounter = 0;
             blockNumber++;
           }
         );
       } else if (data[0] === EOT) {
         log.info("Received EOT");
         socket.write(Buffer.from([ACK]));
         blockNumber--;
         for (let i = packagedBuffer[blockNumber].length - 1; i >= 0; i--) {
           if (packagedBuffer[blockNumber][i] === FILLER) {
             continue;
           } else {
             packagedBuffer[blockNumber] = packagedBuffer[blockNumber].slice(
               0,
               i + 1
             );
             break;
           }
         }
         // At this stage the packaged buffer should be ready for writing
         writeFile(packagedBuffer, filename, function () {
           if (socket.constructor.name === "Socket") {
             socket.destroy();
           } else if (socket.constructor.name === "SerialPort") {
             socket.close();
           }
           // remove the data listener
           socket.removeListener("data", receiveData);
         });
       } else {
         log.warn("GOT SOME UNEXPECTED DATA which was not handled properly!");
         log.warn("===>");
         log.warn(data);
         log.warn("<===");
         log.warn("blockNumber: " + blockNumber);
       }
     };

     socket.on("data", receiveData);
   }
   log(data: any) {
     log.info("modem! : " + data);
   }
 }


 /* Either use the tracer module to output infromation
  * or redefine the functions for silence!
  */
 //const log = require('tracer').colorConsole();
 const log = {
   info: function (data: any) {},
   warn: function (data: any) {},
   error: function (data: any) {},
   debug: function (data: any) {},
 };

 const SOH = 0x01;
 const EOT = 0x04;
 const ACK = 0x06;
 const NAK = 0x15;
 const CAN = 0x18; // not implemented
 const FILLER = 0x1a;
 const CRC_MODE = 0x43;

 let receive_interval_timer: any;

 /**
  * xmodem.js package version.
  * @constant
  * @type {string}
  */
 // Xmodem.prototype.VERSION = require("../package.json").version;

 /**
  * how many timeouts in a row before the sender gives up?
  * @constant
  * @type {integer}
  * @default
  */
 // Xmodem.prototype.XMODEM_MAX_TIMEOUTS = 5;

 /**
  * how many errors on a single block before the receiver gives up?
  * @constant
  * @type {integer}
  * @default
  */
 // Xmodem.prototype.XMODEM_MAX_ERRORS = 10;

 /**
  * how many times should receiver attempt to use CRC?
  * @constant
  * @type {integer}
  * @default
  */
 // Xmodem.prototype.XMODEM_CRC_ATTEMPTS = 3;

 /**
  * Try to use XMODEM-CRC extension or not? Valid options: 'crc' or 'normal'
  * @constant
  * @type {string}
  * @default
  */
 // Xmodem.prototype.XMODEM_OP_MODE = "crc";

 // /**
 //  * First block number. Don't change this unless you have need for non-standard
 //  * implementation.
 //  * @constant
 //  * @type {integer}
 //  * @default
 //  */
 // Xmodem.prototype.XMODEM_START_BLOCK = 1;

 /**
  * default timeout period in seconds
  * @constant
  * @type {integer}
  * @default
  */
 // Xmodem.prototype.timeout_seconds = 10;

 /**
  * how many bytes (excluding header & checksum) in each block? Don't change this
  * unless you have need for non-standard implementation.
  * @constant
  * @type {integer}
  * @default
  */
 // Xmodem.prototype.block_size = 128;

 export default Xmodem;

 /**
  * Internal helper function for scoped intervals
  * @private
  */
 const setIntervalX = function (
   callback: () => void,
   delay: number,
   repetitions: number
 ) {
   let x = 0;
   const intervalID = setInterval(function () {
     if (++x === repetitions) {
       clearInterval(intervalID);
       receive_interval_timer = false;
     }
     callback();
   }, delay);
   return intervalID;
 };

 const sendBlock = function (
   socket: any,
   blockNr: number,
   blockData: any,
   mode: string
 ) {
   let crcCalc = 0;
   let sendBuffer = Buffer.concat([
     Buffer.from([SOH]),
     Buffer.from([blockNr]),
     Buffer.from([0xff - blockNr]),
     blockData,
   ]);
   log.info("SENDBLOCK! Data length: " + blockData.length);
   log.info(sendBuffer);
   if (mode === "crc") {
     let crcString = crc.crc16xmodem(blockData).toString(16);
     // Need to avoid odd string for Buffer creation
     if (crcString.length % 2 == 1) {
       crcString = "0".concat(crcString);
     }
     // CRC must be 2 bytes of length
     if (crcString.length === 2) {
       crcString = "00".concat(crcString);
     }
     sendBuffer = Buffer.concat([sendBuffer, Buffer.from(crcString, "hex")]);
   } else {
     // Count only the blockData into the checksum
     for (let i = 3; i < sendBuffer.length; i++) {
       crcCalc = crcCalc + sendBuffer.readUInt8(i);
     }
     crcCalc = crcCalc % 256;
     let crcCalcStr = crcCalc.toString(16);
     if (crcCalcStr.length % 2 != 0) {
       // Add padding for the string to be even
       crcCalcStr = "0" + crcCalcStr;
     }
     sendBuffer = Buffer.concat([sendBuffer, Buffer.from(crcCalcStr, "hex")]);
   }
   log.info("Sending buffer with total length: " + sendBuffer.length);
   socket.write(sendBuffer);
 };

 const receiveBlock = function (
   socket: any,
   blockNr: number,
   blockData: any,
   block_size: number,
   mode: string,
   callback: (args: any) => void
 ) {
   const cmd = blockData[0];
   const block = parseInt(blockData[1]);
   const block_check = parseInt(blockData[2]);
   let current_block;
   const checksum_length = mode === "crc" ? 2 : 1;

   if (cmd === SOH) {
     if (block + block_check === 0xff) {
       // Are we expecting this block?
       if (block === blockNr % 0x100) {
         current_block = blockData.slice(3, blockData.length - checksum_length);
       } else {
         log.error(
           "ERROR: Synch issue! Received: " + block + " Expected: " + blockNr
         );
         return;
       }
     } else {
       log.error("ERROR: Block integrity check failed!");
       socket.write(Buffer.from([NAK]));
       return;
     }

     if (current_block.length === block_size) {
       socket.write(Buffer.from([ACK]));
       callback(current_block);
     } else {
       log.error(
         "ERROR: Received block size did not match the expected size. Received: " +
           current_block.length +
           " | Expected: " +
           block_size
       );
       socket.write(Buffer.from([NAK]));
       return;
     }
   } else {
     log.error("ERROR!");
     return;
   }
 };

 const writeFile = function (
   buffer: Array<any>,
   filename: string,
   callback: () => void
 ) {
   log.info("writeFile called");
   const fileStream = fs.createWriteStream(filename);
   fileStream.once("open", function () {
     log.info("File stream opened, buffer length: " + buffer.length);
     for (let i = 0; i < buffer.length; i++) {
       fileStream.write(buffer[i]);
     }
     fileStream.end();
     log.info("File written");
     callback();
   });
 };
