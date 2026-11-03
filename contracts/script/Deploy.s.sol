// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script} from "forge-std/Script.sol";
import {Payments} from "../src/Payments.sol";

/// @title  Deploy
/// @notice Publishes Payments. The contract has no constructor: the deployment carries no
///         argument, and the resulting address depends only on the deployer and its nonce.
/// @dev    The key never enters the repository. This script names only the environment
///         variable; `vm.envUint` reverts during the local run if it is not loaded, so the
///         failure shows up before anything is broadcast.
contract Deploy is Script {
    function run() external returns (Payments payments) {
        uint256 deployerKey = vm.envUint("ACC1_KEY");

        vm.startBroadcast(deployerKey);
        payments = new Payments();
        vm.stopBroadcast();
    }
}
