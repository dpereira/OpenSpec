/**
 * Profile System
 *
 * Defines workflow profiles that control which workflows are installed.
 * Profiles determine WHICH workflows; delivery (in global config) determines HOW.
 */

import type { Profile } from './global-config.js';

/**
 * Core workflows included in the 'core' profile.
 * These provide the streamlined experience for new users.
 */
export const CORE_WORKFLOWS = ['propose', 'explore', 'apply', 'update', 'sync', 'archive'] as const;

/**
 * All available workflows in the system.
 */
export const ALL_WORKFLOWS = [
  'propose',
  'explore',
  'new',
  'continue',
  'apply',
  'update',
  'ff',
  'sync',
  'archive',
  'bulk-archive',
  'verify',
  'onboard',
] as const;

export type WorkflowId = (typeof ALL_WORKFLOWS)[number];
export type CoreWorkflowId = (typeof CORE_WORKFLOWS)[number];

/**
 * Utilities installed alongside every profile, independent of workflow
 * selection. They are not workflows (they do not act on a change) and must
 * not appear in the profile picker or be removable through it.
 */
export const UTILITY_WORKFLOWS = ['models'] as const;

export type UtilityWorkflowId = (typeof UTILITY_WORKFLOWS)[number];

/** Every installable skill/command id: selectable workflows plus utilities. */
export const ALL_INSTALLABLE_IDS = [...ALL_WORKFLOWS, ...UTILITY_WORKFLOWS] as const;
export type InstallableId = (typeof ALL_INSTALLABLE_IDS)[number];

/**
 * Unions the required utilities into an effective install set.
 *
 * Every path that decides which skills/commands to generate, reconcile, or
 * expect on disk must go through this (or resolveInstalledWorkflows in
 * skill-generation), so a utility can never be dropped by a raw subset or
 * deleted as a "deselected workflow".
 */
export function withRequiredUtilities(workflows: Iterable<string>): string[] {
  return [...new Set<string>([...workflows, ...UTILITY_WORKFLOWS])];
}

/**
 * Resolves which workflows should be active for a given profile configuration.
 *
 * - 'core' profile always returns CORE_WORKFLOWS
 * - 'custom' profile returns the provided customWorkflows and required dependencies
 *
 * The result describes user-selectable workflows only; callers that install
 * or verify generated files must add the required utilities (see
 * withRequiredUtilities).
 */
export function getProfileWorkflows(
  profile: Profile,
  customWorkflows?: string[]
): readonly string[] {
  if (profile === 'custom') {
    const workflows = customWorkflows ?? [];
    const syncDependentIndex = workflows.findIndex(
      (workflow) => workflow === 'archive' || workflow === 'bulk-archive'
    );

    if (syncDependentIndex !== -1 && !workflows.includes('sync')) {
      return [
        ...workflows.slice(0, syncDependentIndex),
        'sync',
        ...workflows.slice(syncDependentIndex),
      ];
    }

    return workflows;
  }
  return CORE_WORKFLOWS;
}
