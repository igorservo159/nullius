// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {Payments} from "../src/Payments.sol";

/// @dev A payee that refuses value explicitly, to provoke TransferFailed.
contract RejectingPayee {
    receive() external payable {
        revert("rejected");
    }
}

/// @dev A payee with neither `receive` nor `fallback`: refuses for lack of an entry point.
contract SilentPayee {}

/// @dev A payee that refuses while `accepting` is false, to prove that a failed forward
///      does not burn the orderId: the same order settles later.
contract ToggleablePayee {
    bool public accepting;

    function setAccepting(bool value) external {
        accepting = value;
    }

    receive() external payable {
        if (!accepting) revert("rejected");
    }
}

contract PaymentsTest is Test {
    Payments internal payments;

    address internal payer;
    address internal payee;

    bytes32 internal constant SALT = keccak256("salt-1");
    uint256 internal constant AMOUNT = 1 ether;

    /// @dev A fixed triple and the orderId it produces, computed OUTSIDE Solidity with
    ///      `cast abi-encode` + `cast keccak`. It pins the wire format of the orderId:
    ///      this is the vector the Rust app must reproduce byte for byte.
    address internal constant PINNED_PAYEE = 0x1111111111111111111111111111111111111111;
    uint256 internal constant PINNED_AMOUNT = 1 ether;
    bytes32 internal constant PINNED_SALT =
        0x2222222222222222222222222222222222222222222222222222222222222222;
    bytes32 internal constant PINNED_ORDER_ID =
        0x869211b2d967910689ad25d3ba8335e13e467de5f15abeff18cb3aa3663fdfcb;

    /// @dev orderId of the default charge: payee, AMOUNT and SALT. It cannot be `constant`
    ///      because it depends on `payee`, which exists only after setUp.
    bytes32 internal orderId;

    /// @dev Mirrors the contract's formula. Every order in this suite goes through here.
    function orderIdFor(address payee_, uint256 amount_, bytes32 salt_)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(payee_, amount_, salt_));
    }

    function setUp() public {
        payments = new Payments();
        payer = makeAddr("payer");
        payee = makeAddr("payee");
        vm.deal(payer, 10 ether);

        orderId = orderIdFor(payee, AMOUNT, SALT);
    }

    // ------------------------------------------------------------------- happy path

    function test_Pay_MovesExactAmountToPayee() public {
        uint256 payerBefore = payer.balance;
        uint256 payeeBefore = payee.balance;

        vm.prank(payer);
        payments.pay{value: AMOUNT}(orderId, SALT, payee);

        assertEq(payee.balance, payeeBefore + AMOUNT, "payee did not rise by the exact amount");
        assertEq(payer.balance, payerBefore - AMOUNT, "payer did not fall by the exact amount");
    }

    function test_Pay_ContractRetainsNothing() public {
        vm.prank(payer);
        payments.pay{value: AMOUNT}(orderId, SALT, payee);

        assertEq(address(payments).balance, 0, "contract retained value");
    }

    function test_Pay_EmitsPaymentWithOrderId() public {
        vm.expectEmit(true, true, true, true, address(payments));
        emit Payments.Payment(orderId, payer, payee, AMOUNT);

        vm.prank(payer);
        payments.pay{value: AMOUNT}(orderId, SALT, payee);
    }

    // ------------------------------- the orderId commits to the amount and the payee

    function test_Pay_RevertsWhenValueIsBelowCommitted() public {
        bytes32 derived = orderIdFor(payee, AMOUNT - 1, SALT);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(Payments.OrderIdMismatch.selector, orderId, derived)
        );
        payments.pay{value: AMOUNT - 1}(orderId, SALT, payee);
    }

    function test_Pay_RevertsWhenValueIsAboveCommitted() public {
        bytes32 derived = orderIdFor(payee, AMOUNT + 1, SALT);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(Payments.OrderIdMismatch.selector, orderId, derived)
        );
        payments.pay{value: AMOUNT + 1}(orderId, SALT, payee);
    }

    function test_Pay_RevertsWhenPayeeIsNotTheCommittedOne() public {
        address other = makeAddr("other");
        bytes32 derived = orderIdFor(other, AMOUNT, SALT);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(Payments.OrderIdMismatch.selector, orderId, derived)
        );
        payments.pay{value: AMOUNT}(orderId, SALT, other);
    }

    function test_Pay_RevertsOnWrongSalt() public {
        bytes32 wrongSalt = keccak256("salt-2");
        bytes32 derived = orderIdFor(payee, AMOUNT, wrongSalt);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(Payments.OrderIdMismatch.selector, orderId, derived)
        );
        payments.pay{value: AMOUNT}(orderId, wrongSalt, payee);
    }

    /// @dev bytes32(0) has no dedicated guard: there is no special path, it simply does
    ///      not close the hash.
    function test_Pay_RevertsOnZeroOrderId() public {
        bytes32 derived = orderIdFor(payee, AMOUNT, SALT);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(Payments.OrderIdMismatch.selector, bytes32(0), derived)
        );
        payments.pay{value: AMOUNT}(bytes32(0), SALT, payee);
    }

    function test_Pay_MismatchMovesNoValue() public {
        uint256 payerBefore = payer.balance;
        uint256 payeeBefore = payee.balance;

        vm.prank(payer);
        vm.expectRevert();
        payments.pay{value: AMOUNT - 1}(orderId, SALT, payee);

        assertEq(payer.balance, payerBefore, "payer paid despite the mismatch");
        assertEq(payee.balance, payeeBefore, "payee received despite the mismatch");
        assertFalse(payments.paid(orderId), "orderId was marked despite the mismatch");
    }

    // ---------------------------------------------------------------- the two guards

    function test_Pay_RevertsOnZeroPayee() public {
        bytes32 oid = orderIdFor(address(0), AMOUNT, SALT);

        vm.prank(payer);
        vm.expectRevert(Payments.ZeroPayee.selector);
        payments.pay{value: AMOUNT}(oid, SALT, address(0));
    }

    function test_Pay_RevertsOnZeroAmount() public {
        bytes32 oid = orderIdFor(payee, 0, SALT);

        vm.prank(payer);
        vm.expectRevert(Payments.ZeroAmount.selector);
        payments.pay{value: 0}(oid, SALT, payee);
    }

    // -------------------------------------------------- a payee unable to receive

    function test_Pay_RevertsWhenPayeeRejectsValue() public {
        address rejecting = address(new RejectingPayee());
        bytes32 oid = orderIdFor(rejecting, AMOUNT, SALT);

        vm.prank(payer);
        vm.expectRevert(Payments.TransferFailed.selector);
        payments.pay{value: AMOUNT}(oid, SALT, rejecting);
    }

    function test_Pay_RevertsWhenPayeeHasNoReceive() public {
        address silent = address(new SilentPayee());
        bytes32 oid = orderIdFor(silent, AMOUNT, SALT);

        vm.prank(payer);
        vm.expectRevert(Payments.TransferFailed.selector);
        payments.pay{value: AMOUNT}(oid, SALT, silent);
    }

    function test_Pay_RevertsWhenPayeeIsTheContractItself() public {
        bytes32 oid = orderIdFor(address(payments), AMOUNT, SALT);

        vm.prank(payer);
        vm.expectRevert(Payments.TransferFailed.selector);
        payments.pay{value: AMOUNT}(oid, SALT, address(payments));
    }

    // ------------------------------------------------- nothing moves when it reverts

    function test_Pay_NoValueMovesWhenPayeeRejects() public {
        address rejecting = address(new RejectingPayee());
        bytes32 oid = orderIdFor(rejecting, AMOUNT, SALT);
        uint256 payerBefore = payer.balance;

        vm.prank(payer);
        vm.expectRevert(Payments.TransferFailed.selector);
        payments.pay{value: AMOUNT}(oid, SALT, rejecting);

        assertEq(payer.balance, payerBefore, "payer balance changed despite the revert");
        assertEq(rejecting.balance, 0, "payee received despite the revert");
        assertEq(address(payments).balance, 0, "contract retained despite the revert");
    }

    // -------------------------------------- the contract takes value only through pay

    function test_PlainTransferToContractReverts() public {
        vm.deal(address(this), 1 ether);

        (bool ok, ) = address(payments).call{value: 1 ether}("");

        assertFalse(ok, "contract accepted ETH outside pay");
        assertEq(address(payments).balance, 0, "contract retained ETH sent directly");
    }

    // ----------------------------------------------------- authoritative idempotency

    function test_Pay_MarksOrderIdAsPaid() public {
        assertFalse(payments.paid(orderId), "orderId was born marked");

        vm.prank(payer);
        payments.pay{value: AMOUNT}(orderId, SALT, payee);

        assertTrue(payments.paid(orderId), "orderId was not marked");
    }

    function test_Pay_RevertsOnDuplicateOrderId() public {
        vm.prank(payer);
        payments.pay{value: AMOUNT}(orderId, SALT, payee);

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Payments.AlreadyPaid.selector, orderId));
        payments.pay{value: AMOUNT}(orderId, SALT, payee);
    }

    function test_Pay_DuplicateMovesNoValue() public {
        vm.prank(payer);
        payments.pay{value: AMOUNT}(orderId, SALT, payee);

        uint256 payerAfterFirst = payer.balance;
        uint256 payeeAfterFirst = payee.balance;

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Payments.AlreadyPaid.selector, orderId));
        payments.pay{value: AMOUNT}(orderId, SALT, payee);

        assertEq(payer.balance, payerAfterFirst, "payer paid twice");
        assertEq(payee.balance, payeeAfterFirst, "payee received twice");
        assertEq(address(payments).balance, 0, "contract retained value");
    }

    function test_Pay_FailedTransferDoesNotBurnOrderId() public {
        ToggleablePayee toggle = new ToggleablePayee();
        bytes32 oid = orderIdFor(address(toggle), AMOUNT, SALT);

        vm.prank(payer);
        vm.expectRevert(Payments.TransferFailed.selector);
        payments.pay{value: AMOUNT}(oid, SALT, address(toggle));

        assertFalse(payments.paid(oid), "orderId was marked despite the revert");

        toggle.setAccepting(true);

        vm.prank(payer);
        payments.pay{value: AMOUNT}(oid, SALT, address(toggle));

        assertEq(address(toggle).balance, AMOUNT, "the same order did not settle later");
    }

    function test_Pay_DistinctOrderIdsDoNotCollide() public {
        bytes32 otherSalt = keccak256("salt-2");
        bytes32 other = orderIdFor(payee, AMOUNT, otherSalt);

        vm.prank(payer);
        payments.pay{value: AMOUNT}(orderId, SALT, payee);

        vm.prank(payer);
        payments.pay{value: AMOUNT}(other, otherSalt, payee);

        assertEq(payee.balance, 2 * AMOUNT, "the second orderId was blocked");
    }

    // ------------------------------------------------------------------------- fuzz

    function testFuzz_Pay_MovesExactAmount(bytes32 salt, uint96 amount) public {
        vm.assume(amount > 0);
        bytes32 oid = orderIdFor(payee, amount, salt);
        vm.deal(payer, amount);

        uint256 payeeBefore = payee.balance;

        vm.prank(payer);
        payments.pay{value: amount}(oid, salt, payee);

        assertEq(payee.balance, payeeBefore + amount);
        assertEq(payer.balance, 0);
        assertEq(address(payments).balance, 0);
    }

    function testFuzz_Pay_RevertsWhenValueDiverges(uint96 committed, uint96 sent) public {
        vm.assume(committed > 0 && sent > 0 && sent != committed);

        bytes32 oid = orderIdFor(payee, committed, SALT);
        bytes32 derived = orderIdFor(payee, sent, SALT);
        vm.deal(payer, sent);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(Payments.OrderIdMismatch.selector, oid, derived)
        );
        payments.pay{value: sent}(oid, SALT, payee);
    }

    // ------------------------------------------------- the orderId wire format, pinned

    function test_OrderIdFormulaIsPinned() public {
        assertEq(
            orderIdFor(PINNED_PAYEE, PINNED_AMOUNT, PINNED_SALT),
            PINNED_ORDER_ID,
            "the orderId formula changed"
        );
    }

    function test_Pay_AcceptsPinnedOrderId() public {
        vm.prank(payer);
        payments.pay{value: PINNED_AMOUNT}(PINNED_ORDER_ID, PINNED_SALT, PINNED_PAYEE);

        assertTrue(payments.paid(PINNED_ORDER_ID), "the contract did not derive the pinned orderId");
    }
}
