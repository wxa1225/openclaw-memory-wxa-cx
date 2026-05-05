// Team Capability Model — Transactive Memory System (who knows what + trust)

import * as fs from "fs";
import * as path from "path";
import type { LedgerEntry, MemberCapability, TeamCapabilityProfile } from "./storage/types.js";

// Tags that should not be treated as expertise areas
const NOISE_TAGS = new Set([
  "general", "todo", "wip", "test", "draft", "temp", "note",
]);

const EXPERTISE_CATEGORIES = new Set([
  "decision", "api", "process", "experience", "security",
]);

export class TeamCapabilityModel {
  private profile: TeamCapabilityProfile;
  private storagePath: string;

  constructor(teamId: string, projectRoot: string) {
    this.profile = {
      teamId,
      members: {},
      updatedAt: new Date().toISOString(),
    };
    this.storagePath = path.join(projectRoot, "memory", "tms", "profile.json");
  }

  /** Load existing profile from disk */
  async load(): Promise<void> {
    try {
      const raw = await fs.promises.readFile(this.storagePath, "utf-8");
      const data = JSON.parse(raw) as TeamCapabilityProfile;
      this.profile = data;
    } catch {
      // No existing profile — start empty
    }
  }

  /** Update profile from current ledger state */
  async syncFromLedger(entries: LedgerEntry[]): Promise<void> {
    await this.load(); // Refresh from disk first

    for (const entry of entries) {
      for (const claim of entry.claims) {
        // Track injector
        this._ensureMember(claim.injected_by);
        const injector = this.profile.members[claim.injected_by]!;
        if (!injector.knownMemoryIds.includes(entry.id)) {
          injector.knownMemoryIds.push(entry.id);
        }
        injector.contributionCount++;
        injector.lastActiveAt = new Date().toISOString();
        this._updateExpertise(injector, entry);

        // Track confirmers
        for (const confirmer of claim.confirmed_by) {
          this._ensureMember(confirmer);
          const member = this.profile.members[confirmer]!;
          if (!member.knownMemoryIds.includes(entry.id)) {
            member.knownMemoryIds.push(entry.id);
          }
          member.confirmationCount++;
          member.lastActiveAt = new Date().toISOString();
          this._updateExpertise(member, entry);
        }
      }
    }

    // Recompute trust scores
    for (const [id, member] of Object.entries(this.profile.members)) {
      this.profile.members[id].trustScore = this.computeTrustScore(id);
    }

    this.profile.updatedAt = new Date().toISOString();
    await this.save();
  }

  /** Get all members */
  getAllMembers(): MemberCapability[] {
    return Object.values(this.profile.members);
  }

  /** Get a single member's capability */
  getMember(memberId: string): MemberCapability | undefined {
    return this.profile.members[memberId];
  }

  /** Get members who know a specific memory */
  getMembersForMemory(memoryId: string): string[] {
    const result: string[] = [];
    for (const [id, member] of Object.entries(this.profile.members)) {
      if (member.knownMemoryIds.includes(memoryId)) {
        result.push(id);
      }
    }
    return result;
  }

  /** Get expertise areas for a member */
  getMemberExpertise(memberId: string): string[] {
    return this.profile.members[memberId]?.expertiseAreas ?? [];
  }

  /** Calculate trust score based on contributions */
  computeTrustScore(memberId: string): number {
    const member = this.profile.members[memberId];
    if (!member) return 0.5;
    const total = member.contributionCount + member.confirmationCount;
    if (total === 0) return 0.5;
    // Sigmoid-like curve: trust grows with contributions, capped at 1.0
    return Math.min(1.0, 0.5 + 0.5 * (1 - Math.exp(-total / 10)));
  }

  // ---- Internal ----

  private _ensureMember(memberId: string): void {
    if (!this.profile.members[memberId]) {
      this.profile.members[memberId] = {
        memberId,
        displayName: memberId,
        expertiseAreas: [],
        knownMemoryIds: [],
        trustScore: 0.5,
        lastActiveAt: new Date().toISOString(),
        contributionCount: 0,
        confirmationCount: 0,
      };
    }
  }

  private _updateExpertise(member: MemberCapability, entry: LedgerEntry): void {
    if (EXPERTISE_CATEGORIES.has(entry.category) && !member.expertiseAreas.includes(entry.category)) {
      member.expertiseAreas.push(entry.category);
    }
    for (const tag of entry.tags) {
      const tagLower = tag.toLowerCase();
      if (NOISE_TAGS.has(tagLower)) continue;
      if (!member.expertiseAreas.includes(tag)) {
        member.expertiseAreas.push(tag);
      }
    }
  }

  private async save(): Promise<void> {
    const dir = path.dirname(this.storagePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(this.storagePath, JSON.stringify(this.profile, null, 2), "utf-8");
  }
}
