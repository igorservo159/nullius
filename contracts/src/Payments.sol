// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title  Payments
/// @notice Direct value transfer from a payer to a payee, identified by an orderId that
///         commits to the payee, the amount and a salt drawn when the charge is created.
/// @dev    The contract holds no value. Every msg.value received by `pay` is forwarded to
///         the payee in the same transaction, and a failed forward reverts the whole
///         transaction. No function reads address(this).balance, and there is neither a
///         `receive` nor a `fallback`: the contract accepts value only through `pay`.
///         Each orderId settles at most once. The guard is authoritative because the EVM
///         executes transactions in total order: the second call reads what the first
///         wrote, even within the same block.
///         The orderId is recomputed from the arguments and the value sent: a call whose
///         value or payee differs from what the order committed to does not close the
///         hash and reverts before any value moves.
contract Payments {
    /// @notice orderIds already settled by this contract.
    /// @dev    Public on purpose: the app answers "has this orderId been paid?" with a
    ///         single call, without scanning a range of blocks for logs.
    mapping(bytes32 => bool) public paid;

    /// @notice A forward completed.
    /// @param orderId keccak256(abi.encode(payee, amount, salt)) of the order.
    /// @param payer   Account that signed and funded the transaction.
    /// @param payee   Account that received the value.
    /// @param amount  Value forwarded, in wei.
    event Payment(
        bytes32 indexed orderId,
        address indexed payer,
        address indexed payee,
        uint256 amount
    );

    /// @notice Forwarding to the zero address would burn the value.
    error ZeroPayee();
    /// @notice A payment without value would emit a payment event without a payment.
    error ZeroAmount();
    /// @notice The presented orderId does not match keccak256(payee, msg.value, salt).
    /// @param presented orderId the call presented.
    /// @param derived   orderId recomputed from the arguments and the value sent.
    error OrderIdMismatch(bytes32 presented, bytes32 derived);
    /// @notice This orderId has already settled. Carries the rejected orderId in the
    ///         revert data.
    error AlreadyPaid(bytes32 orderId);
    /// @notice The payee refused the value, or is unable to receive it.
    error TransferFailed();

    /// @notice Forwards msg.value to the payee and publishes the event with the orderId.
    /// @param orderId keccak256(abi.encode(payee, amount, salt)), computed by the payee
    ///        when the charge was created.
    /// @param salt    32 random bytes of the charge; the only part of the hash the
    ///        contract cannot obtain on its own.
    /// @param payee   Account that receives the value.
    function pay(bytes32 orderId, bytes32 salt, address payee) external payable {
        // checks
        if (payee == address(0)) revert ZeroPayee();
        if (msg.value == 0) revert ZeroAmount();

        bytes32 derived = keccak256(abi.encode(payee, msg.value, salt));
        if (derived != orderId) revert OrderIdMismatch(orderId, derived);

        if (paid[orderId]) revert AlreadyPaid(orderId);

        // effects
        paid[orderId] = true;
        emit Payment(orderId, msg.sender, payee, msg.value);

        // interactions
        (bool ok, ) = payee.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
    }
}
