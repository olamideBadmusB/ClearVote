 
import { describe, it, expect, beforeEach } from "vitest";

interface VoterData {
	id: bigint;
	eligibility: boolean;
	registrationBlock: bigint;
	status: bigint;
	metadataHash: Uint8Array;
}

const STATUS_PENDING = 0n;
const STATUS_APPROVED = 1n;
const STATUS_REVOKED = 2n;

const mockContract = {
	admin: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM" as string,
	paused: false as boolean,
	nextVoterId: 1n as bigint,
	authorizedOfficials: new Map<string, boolean>(),
	voters: new Map<string, VoterData>(),
	voterIds: new Map<bigint, string>(),

	currentBlock: 100n as bigint, // Mock block height

	isAdmin(caller: string): boolean {
		return caller === this.admin;
	},

	isOfficial(caller: string): boolean {
		return this.authorizedOfficials.get(caller) || false;
	},

	isAuthorized(caller: string): boolean {
		return this.isAdmin(caller) || this.isOfficial(caller);
	},

	setPaused(
		caller: string,
		pause: boolean
	): { value: boolean } | { error: number } {
		if (!this.isAdmin(caller)) return { error: 100 };
		this.paused = pause;
		return { value: pause };
	},

	transferAdmin(
		caller: string,
		newAdmin: string
	): { value: boolean } | { error: number } {
		if (!this.isAdmin(caller)) return { error: 100 };
		if (newAdmin === caller) return { error: 105 }; // Assuming zero-address check simplified
		this.admin = newAdmin;
		return { value: true };
	},

	addOfficial(
		caller: string,
		official: string
	): { value: boolean } | { error: number } {
		if (!this.isAdmin(caller)) return { error: 100 };
		this.authorizedOfficials.set(official, true);
		return { value: true };
	},

	removeOfficial(
		caller: string,
		official: string
	): { value: boolean } | { error: number } {
		if (!this.isAdmin(caller)) return { error: 100 };
		this.authorizedOfficials.delete(official);
		return { value: true };
	},

	registerVoter(
		caller: string,
		metadataHash: Uint8Array
	): { value: bigint } | { error: number } {
		if (this.paused) return { error: 104 };
		if (this.voters.has(caller)) return { error: 101 };
		const newId = this.nextVoterId;
		this.voters.set(caller, {
			id: newId,
			eligibility: false,
			registrationBlock: this.currentBlock,
			status: STATUS_PENDING,
			metadataHash,
		});
		this.voterIds.set(newId, caller);
		this.nextVoterId += 1n;
		return { value: newId };
	},

	approveVoter(
		caller: string,
		voter: string
	): { value: boolean } | { error: number } {
		if (this.paused) return { error: 104 };
		if (!this.isAuthorized(caller)) return { error: 100 };
		const voterData = this.voters.get(voter);
		if (!voterData) return { error: 102 };
		if (voterData.status !== STATUS_PENDING) return { error: 103 };
		voterData.eligibility = true;
		voterData.status = STATUS_APPROVED;
		return { value: true };
	},

	revokeVoter(
		caller: string,
		voter: string
	): { value: boolean } | { error: number } {
		if (this.paused) return { error: 104 };
		if (!this.isAuthorized(caller)) return { error: 100 };
		const voterData = this.voters.get(voter);
		if (!voterData) return { error: 102 };
		if (voterData.status === STATUS_REVOKED) return { error: 103 };
		voterData.eligibility = false;
		voterData.status = STATUS_REVOKED;
		return { value: true };
	},

	selfRevoke(caller: string): { value: boolean } | { error: number } {
		if (this.paused) return { error: 104 };
		const voterData = this.voters.get(caller);
		if (!voterData) return { error: 102 };
		voterData.eligibility = false;
		voterData.status = STATUS_REVOKED;
		return { value: true };
	},

	isEligible(voter: string): { value: boolean } | { error: number } {
		const voterData = this.voters.get(voter);
		if (!voterData) return { error: 102 };
		return {
			value: voterData.eligibility && voterData.status === STATUS_APPROVED,
		};
	},

	getVoterDetails(voter: string): { value: VoterData | undefined } {
		return { value: this.voters.get(voter) };
	},

	// Add more mock functions as needed for completeness
};

describe("ClearVote Voter Registry Contract", () => {
	beforeEach(() => {
		mockContract.admin = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
		mockContract.paused = false;
		mockContract.nextVoterId = 1n;
		mockContract.authorizedOfficials = new Map();
		mockContract.voters = new Map();
		mockContract.voterIds = new Map();
		mockContract.currentBlock = 100n;
	});

	it("should allow admin to add official", () => {
		const result = mockContract.addOfficial(
			mockContract.admin,
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		);
		expect(result).toEqual({ value: true });
		expect(
			mockContract.authorizedOfficials.get(
				"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
			)
		).toBe(true);
	});

	it("should prevent non-admin from adding official", () => {
		const result = mockContract.addOfficial(
			"ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP",
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		);
		expect(result).toEqual({ error: 100 });
	});

	it("should register a new voter", () => {
		const metadataHash = new Uint8Array(32); // Mock hash
		const result = mockContract.registerVoter(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK",
			metadataHash
		);
		expect(result).toEqual({ value: 1n });
		const details = mockContract.getVoterDetails(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		).value;
		expect(details?.id).toBe(1n);
		expect(details?.status).toBe(STATUS_PENDING);
		expect(details?.registrationBlock).toBe(100n);
	});

	it("should prevent duplicate registration", () => {
		const metadataHash = new Uint8Array(32);
		mockContract.registerVoter(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK",
			metadataHash
		);
		const result = mockContract.registerVoter(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK",
			metadataHash
		);
		expect(result).toEqual({ error: 101 });
	});

	it("should approve a pending voter by official", () => {
		const metadataHash = new Uint8Array(32);
		mockContract.addOfficial(mockContract.admin, mockContract.admin); // Make admin official for test
		mockContract.registerVoter(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK",
			metadataHash
		);
		const result = mockContract.approveVoter(
			mockContract.admin,
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		);
		expect(result).toEqual({ value: true });
		const details = mockContract.getVoterDetails(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		).value;
		expect(details?.status).toBe(STATUS_APPROVED);
		expect(details?.eligibility).toBe(true);
	});

	it("should not approve non-pending voter", () => {
		const metadataHash = new Uint8Array(32);
		mockContract.addOfficial(mockContract.admin, mockContract.admin);
		mockContract.registerVoter(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK",
			metadataHash
		);
		mockContract.approveVoter(
			mockContract.admin,
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		);
		const result = mockContract.approveVoter(
			mockContract.admin,
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		);
		expect(result).toEqual({ error: 103 });
	});

	it("should revoke an approved voter", () => {
		const metadataHash = new Uint8Array(32);
		mockContract.addOfficial(mockContract.admin, mockContract.admin);
		mockContract.registerVoter(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK",
			metadataHash
		);
		mockContract.approveVoter(
			mockContract.admin,
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		);
		const result = mockContract.revokeVoter(
			mockContract.admin,
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		);
		expect(result).toEqual({ value: true });
		const details = mockContract.getVoterDetails(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		).value;
		expect(details?.status).toBe(STATUS_REVOKED);
		expect(details?.eligibility).toBe(false);
	});

	it("should allow self-revoke", () => {
		const metadataHash = new Uint8Array(32);
		mockContract.registerVoter(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK",
			metadataHash
		);
		const result = mockContract.selfRevoke(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		);
		expect(result).toEqual({ value: true });
		const details = mockContract.getVoterDetails(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		).value;
		expect(details?.status).toBe(STATUS_REVOKED);
	});

	it("should check eligibility correctly", () => {
		const metadataHash = new Uint8Array(32);
		mockContract.addOfficial(mockContract.admin, mockContract.admin);
		mockContract.registerVoter(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK",
			metadataHash
		);
		mockContract.approveVoter(
			mockContract.admin,
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		);
		const result = mockContract.isEligible(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK"
		);
		expect(result).toEqual({ value: true });
	});

	it("should not allow actions when paused", () => {
		mockContract.setPaused(mockContract.admin, true);
		const metadataHash = new Uint8Array(32);
		const result = mockContract.registerVoter(
			"ST2CY5V39NHDP5P0TP2KS8AMGE0MC0H7ADD0T0GVK",
			metadataHash
		);
		expect(result).toEqual({ error: 104 });
	});
});