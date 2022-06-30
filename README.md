# xmodem.ts

This is typescript fork of https://github.com/exsilium/xmodem.js with modified exports. All credits goes to Sten Feldman.

XMODEM is a simple file transfer protocol. This project implements the protocol in JavaScript. Please see the [API docs](https://exsilium.github.io/xmodem.js/) for more details.

# Installation

`npm install xmodem.ts`

# Usage

## Sending

```
import { Xmodem } from 'xmodem.ts'
xmodem.send(socket, buffer);
```

## Receiving

```
import { Xmodem } from 'xmodem.ts'
xmodem.receive(socket, receiveFile);
```
