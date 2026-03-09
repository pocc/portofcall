#!/usr/bin/env python3
"""Modbus TCP Server Simulator for protocol testing."""

import logging
from pymodbus.server import StartTcpServer
from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusSlaveContext,
    ModbusServerContext,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')


def run_server():
    # Create data blocks with test values
    # Coils (digital outputs): 100 coils starting at address 0
    coils = ModbusSequentialDataBlock(0, [False] * 50 + [True] * 50)

    # Discrete Inputs: 100 inputs
    discrete_inputs = ModbusSequentialDataBlock(0, [True, False] * 50)

    # Holding Registers: 100 registers with test values
    holding_registers = ModbusSequentialDataBlock(0, list(range(100)))

    # Input Registers: 100 registers
    input_registers = ModbusSequentialDataBlock(0, [i * 10 for i in range(100)])

    store = ModbusSlaveContext(
        di=discrete_inputs,
        co=coils,
        hr=holding_registers,
        ir=input_registers,
    )

    context = ModbusServerContext(slaves=store, single=True)

    logging.info("Starting Modbus TCP server on port 502...")
    StartTcpServer(context=context, address=("0.0.0.0", 502))


if __name__ == '__main__':
    run_server()
