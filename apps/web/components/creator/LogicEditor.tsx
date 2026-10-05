"use client";
import { useState } from "react";
import {
  identifierSchema,
  levelSchema,
  type LevelData,
  type LogicBlock,
  type LogicCondition,
  type Scalar,
  type Variable,
} from "../../../../packages/platform/src/classes/models";
import {
  defaultAction,
  defaultCondition,
  defaultVariable,
  logicReferenceErrors,
  renameVariable,
  reorder,
} from "./logicEditing";
import {
  ActionFields,
  ConditionFields,
  EventFields,
  ScalarField,
} from "./LogicFields";
import styles from "./LogicEditor.module.css";

function changeVariableType(
  level: LevelData,
  name: string,
  type: Variable["type"],
): LevelData {
  const initial: Scalar =
    type === "boolean" ? false : type === "number" ? 0 : "";
  function condition(value: LogicCondition): LogicCondition {
    if (value.type === "and" || value.type === "or")
      return { ...value, conditions: value.conditions.map(condition) };
    if (value.type === "variable" && value.variable === name)
      return { ...value, value: initial, operator: "eq" };
    return value;
  }
  return {
    ...level,
    variables: (level.variables ?? []).map((variable) =>
      variable.name === name ? { ...variable, type, initial } : variable,
    ),
    logic: (level.logic ?? []).map((block) => ({
      ...block,
      event:
        "variable" in block.event &&
        block.event.variable === name &&
        block.event.type === "variable-reaches"
          ? { ...block.event, value: initial }
          : block.event,
      ...(block.condition ? { condition: condition(block.condition) } : {}),
      actions: block.actions.map((action) =>
        action.type === "set-variable" && action.variable === name
          ? { ...action, value: initial }
          : action,
      ),
    })),
  };
}

export default function LogicEditor({
  level,
  onChange,
}: {
  level: LevelData;
  onChange: (level: LevelData) => void;
}) {
  const [nameError, setNameError] = useState<string | null>(null);
  const blocks = level.logic ?? [];
  const variables = level.variables ?? [];
  const references = logicReferenceErrors(level);
  const validation = levelSchema.safeParse(level);
  const messages = validation.success
    ? []
    : [...new Set(validation.error.issues.map((issue) => issue.message))].slice(
        0,
        8,
      );
  function commit(next: LevelData) {
    onChange({ ...next, schemaVersion: 2 });
  }
  function updateBlock(id: string, patch: Partial<LogicBlock>) {
    commit({
      ...level,
      logic: blocks.map((block) =>
        block.id === id ? { ...block, ...patch } : block,
      ),
    });
  }
  function newBlock() {
    const block: LogicBlock = {
      id: crypto.randomUUID(),
      label: `Logic ${blocks.length + 1}`,
      enabled: true,
      event: { type: "level-start" },
      actions: [defaultAction("show-text", level)],
    };
    commit({ ...level, logic: [...blocks, block] });
  }
  return (
    <section className={styles.editor} aria-label="Visual logic editor">
      <div className={styles.heading}>
        <div>
          <h2>Variables &amp; logic</h2>
          <p>
            When an event happens, check its conditions, then run the actions in
            order.
          </p>
        </div>
        <span className={styles.pill}>No scripts · deterministic play</span>
      </div>
      <details className={styles.help}>
        <summary>How to build a logic level</summary>
        <p>
          Give scene objects a name in the inspector, such as “Entrance zone” or
          “Exit door”. Add a variable to remember progress. Create a block with
          an event, add optional conditions, then choose its actions.
        </p>
        <p>
          Example: when the player enters Entrance zone, if they have the item
          key, open Exit door and show a message. Use timers for delays and
          named events for reusable steps. Actions run from top to bottom;
          blocks with the same event run from top to bottom.
        </p>
        <p>
          Project limits: 32 variables, 64 blocks, 16 actions per block, eight
          conditions per group, three nested groups, and 1,024 total logic
          nodes. Runtime execution and spawning have separate safety limits.
        </p>
      </details>
      <section className={styles.variables} aria-label="Project variables">
        <div className={styles.heading}>
          <h3>
            Project variables <span>{variables.length}/32</span>
          </h3>
          <button
            type="button"
            disabled={variables.length >= 32}
            onClick={() => {
              setNameError(null);
              commit({
                ...level,
                variables: [...variables, defaultVariable(variables)],
              });
            }}
          >
            + Add variable
          </button>
        </div>
        {!variables.length && (
          <p className={styles.empty}>
            No variables yet. Add a boolean for a switch, a number for a score,
            or short text for a message.
          </p>
        )}
        {variables.map((variable, index) => (
          <div
            key={variable.name}
            className={styles.variableRow}
            role="group"
            aria-label={`Variable ${index + 1}`}
          >
            <label>
              Name
              <input
                defaultValue={variable.name}
                aria-label={`Variable ${index + 1} name`}
                maxLength={40}
                spellCheck={false}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (name === variable.name) return;
                  const parsed = identifierSchema.safeParse(name);
                  if (!parsed.success) {
                    setNameError(parsed.error.issues[0].message);
                    return;
                  }
                  if (variables.some((candidate) => candidate.name === name)) {
                    setNameError("Each variable needs a unique name.");
                    return;
                  }
                  setNameError(null);
                  commit(renameVariable(level, variable.name, name));
                }}
              />
            </label>
            <label>
              Type
              <select
                value={variable.type}
                aria-label={`Variable ${index + 1} type`}
                onChange={(event) => {
                  const type = event.target.value;
                  if (
                    type === "boolean" ||
                    type === "number" ||
                    type === "string"
                  )
                    commit(changeVariableType(level, variable.name, type));
                }}
              >
                <option value="boolean">Boolean (true / false)</option>
                <option value="number">Number</option>
                <option value="string">Short text</option>
              </select>
            </label>
            <ScalarField
              label={`Variable ${index + 1} initial value`}
              type={variable.type}
              value={variable.initial}
              onChange={(initial) =>
                commit({
                  ...level,
                  variables: variables.map((candidate) =>
                    candidate.name === variable.name
                      ? { ...candidate, initial }
                      : candidate,
                  ),
                })
              }
            />
            <button
              type="button"
              aria-label={`Delete variable ${variable.name}`}
              onClick={() => {
                if (
                  !window.confirm(
                    `Delete variable “${variable.name}”? Logic that uses it will need a replacement. Undo can restore it.`,
                  )
                )
                  return;
                commit({
                  ...level,
                  variables: variables.filter(
                    (candidate) => candidate.name !== variable.name,
                  ),
                });
              }}
            >
              Delete variable
            </button>
          </div>
        ))}
        <p className={styles.small}>
          Names start with a letter and use letters, numbers, underscores or
          hyphens. Renaming updates every reference and can be undone.
        </p>
        {nameError && (
          <p className={styles.error} role="alert">
            {nameError}
          </p>
        )}
      </section>
      {messages.length > 0 && (
        <div className={styles.error} role="alert">
          <strong>Fix these before saving or playtesting:</strong>
          <ul>
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.heading}>
        <h3>
          Logic blocks <span>{blocks.length}/64</span>
        </h3>
        <button type="button" disabled={blocks.length >= 64} onClick={newBlock}>
          + Add logic block
        </button>
      </div>
      {!blocks.length && (
        <p className={styles.empty}>
          Start with “Level starts → Show text”, or connect a named scene object
          to an event.
        </p>
      )}
      {blocks.map((block, index) => (
        <article
          className={`${styles.block} ${block.enabled === false ? styles.disabled : ""}`}
          key={block.id}
          aria-label={`Logic block ${index + 1}`}
        >
          <div className={styles.blockHeading}>
            <span className={styles.ordinal}>{index + 1}</span>
            <label className={styles.blockName}>
              Block name
              <input
                aria-label={`Logic block ${index + 1} name`}
                value={block.label}
                maxLength={80}
                onChange={(event) =>
                  updateBlock(block.id, { label: event.target.value })
                }
              />
            </label>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={block.enabled !== false}
                onChange={(event) =>
                  updateBlock(block.id, { enabled: event.target.checked })
                }
              />
              Enabled
            </label>
            <div className={styles.controls}>
              <button
                type="button"
                aria-label={`Move logic block ${index + 1} up`}
                disabled={index === 0}
                onClick={() =>
                  commit({ ...level, logic: reorder(blocks, index, -1) })
                }
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move logic block ${index + 1} down`}
                disabled={index === blocks.length - 1}
                onClick={() =>
                  commit({ ...level, logic: reorder(blocks, index, 1) })
                }
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Duplicate logic block ${index + 1}`}
                disabled={blocks.length >= 64}
                onClick={() =>
                  commit({
                    ...level,
                    logic: [
                      ...blocks.slice(0, index + 1),
                      {
                        ...structuredClone(block),
                        id: crypto.randomUUID(),
                        label: `${block.label || "Logic"} copy`.slice(0, 80),
                      },
                      ...blocks.slice(index + 1),
                    ],
                  })
                }
              >
                Duplicate block
              </button>
              <button
                type="button"
                aria-label={`Delete logic block ${index + 1}`}
                onClick={() =>
                  commit({
                    ...level,
                    logic: blocks.filter(
                      (candidate) => candidate.id !== block.id,
                    ),
                  })
                }
              >
                Delete block
              </button>
            </div>
          </div>
          {references
            .filter((reference) => reference.blockId === block.id)
            .map((reference, at) => (
              <p
                key={`${reference.message}-${at}`}
                role="alert"
                className={styles.error}
              >
                {reference.message}
              </p>
            ))}
          <div className={styles.step}>
            <strong className={styles.when}>WHEN</strong>
            <EventFields
              event={block.event}
              level={level}
              onChange={(event) => updateBlock(block.id, { event })}
            />
          </div>
          <div className={styles.step}>
            <strong className={styles.if}>IF</strong>
            <div className={styles.stepContent}>
              {block.condition ? (
                <>
                  <ConditionFields
                    condition={block.condition}
                    level={level}
                    onChange={(condition) =>
                      updateBlock(block.id, { condition })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => {
                      // Optional properties are removed rather than set to undefined before serialization.
                      const next = { ...block };
                      delete next.condition;
                      commit({
                        ...level,
                        logic: blocks.map((candidate) =>
                          candidate.id === block.id ? next : candidate,
                        ),
                      });
                    }}
                  >
                    Remove all conditions
                  </button>
                </>
              ) : (
                <>
                  <p className={styles.small}>
                    Always run when the event happens.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      updateBlock(block.id, {
                        condition: defaultCondition("health", level),
                      })
                    }
                  >
                    + Add condition
                  </button>
                </>
              )}
            </div>
          </div>
          <div className={styles.step}>
            <strong className={styles.then}>THEN</strong>
            <div className={styles.stepContent}>
              {block.actions.map((action, at) => (
                <div
                  className={styles.action}
                  key={at}
                  role="group"
                  aria-label={`Action ${at + 1}`}
                >
                  <span className={styles.actionNumber}>{at + 1}.</span>
                  <ActionFields
                    action={action}
                    level={level}
                    onChange={(next) =>
                      updateBlock(block.id, {
                        actions: block.actions.map((candidate, actionIndex) =>
                          actionIndex === at ? next : candidate,
                        ),
                      })
                    }
                  />
                  <div className={styles.controls}>
                    <button
                      type="button"
                      aria-label={`Move action ${at + 1} up`}
                      disabled={at === 0}
                      onClick={() =>
                        updateBlock(block.id, {
                          actions: reorder(block.actions, at, -1),
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move action ${at + 1} down`}
                      disabled={at === block.actions.length - 1}
                      onClick={() =>
                        updateBlock(block.id, {
                          actions: reorder(block.actions, at, 1),
                        })
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Duplicate action ${at + 1}`}
                      disabled={block.actions.length >= 16}
                      onClick={() =>
                        updateBlock(block.id, {
                          actions: [
                            ...block.actions.slice(0, at + 1),
                            structuredClone(action),
                            ...block.actions.slice(at + 1),
                          ],
                        })
                      }
                    >
                      Duplicate action
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete action ${at + 1}`}
                      disabled={block.actions.length <= 1}
                      onClick={() =>
                        updateBlock(block.id, {
                          actions: block.actions.filter(
                            (_, actionIndex) => actionIndex !== at,
                          ),
                        })
                      }
                    >
                      Delete action
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                disabled={block.actions.length >= 16}
                onClick={() =>
                  updateBlock(block.id, {
                    actions: [
                      ...block.actions,
                      defaultAction("show-text", level),
                    ],
                  })
                }
              >
                + Add action
              </button>
              {block.actions.length >= 16 && (
                <p className={styles.small}>
                  This block has reached its 16-action limit.
                </p>
              )}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
