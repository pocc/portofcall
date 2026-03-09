#!/usr/bin/env python3
"""OPC UA Server Simulator for protocol testing."""

import asyncio
import logging
from asyncua import Server, ua

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')


async def main():
    server = Server()
    await server.init()

    server.set_endpoint("opc.tcp://0.0.0.0:4840/freeopcua/server/")
    server.set_server_name("Port of Call OPC UA Test Server")

    # Set up namespace
    uri = "http://test.local/opcua"
    idx = await server.register_namespace(uri)

    # Create test objects and variables
    objects = server.nodes.objects

    # Test device folder
    device = await objects.add_object(idx, "TestDevice")

    # Temperature sensor
    temp = await device.add_variable(idx, "Temperature", 22.5)
    await temp.set_writable()

    # Pressure sensor
    pressure = await device.add_variable(idx, "Pressure", 1013.25)
    await pressure.set_writable()

    # Status flag
    status = await device.add_variable(idx, "Status", True)
    await status.set_writable()

    # Counter
    counter = await device.add_variable(idx, "Counter", 0, ua.VariantType.Int32)
    await counter.set_writable()

    logging.info("Starting OPC UA server on port 4840...")

    async with server:
        count = 0
        while True:
            await asyncio.sleep(1)
            count += 1
            await counter.write_value(ua.Variant(count, ua.VariantType.Int32))


if __name__ == '__main__':
    asyncio.run(main())
