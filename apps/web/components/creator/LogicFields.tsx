"use client";
import type {
  LevelData,
  LevelObject,
  LogicAction,
  LogicCondition,
  LogicEvent,
  Scalar,
  Variable,
} from "../../../../packages/platform/src/classes/models";
import {
  actionLabels,
  conditionLabels,
  defaultAction,
  defaultCondition,
  defaultEvent,
  eventLabels,
  objectLabel,
  objectsForAction,
  objectsForEvent,
  reorder,
} from "./logicEditing";
import styles from "./LogicEditor.module.css";

export function isKey<T extends object>(
  record: T,
  key: string,
): key is Extract<keyof T, string> {
  return Object.hasOwn(record, key);
}

export function NumberField({
  label,
  value,
  onChange,
  min = -1_000_000,
  max = 1_000_000,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          if (!event.target.value.trim()) return;
          const value = Number(event.target.value);
          if (Number.isFinite(value))
            onChange(
              Math.max(
                min,
                Math.min(max, step === 1 ? Math.round(value) : value),
              ),
            );
        }}
      />
    </label>
  );
}

export function ScalarField({
  label,
  value,
  type,
  onChange,
}: {
  label: string;
  value: Scalar;
  type: Variable["type"];
  onChange: (value: Scalar) => void;
}) {
  if (type === "boolean")
    return (
      <label>
        {label}
        <select
          aria-label={label}
          value={String(value)}
          onChange={(event) => onChange(event.target.value === "true")}
        >
          <option value="false">False</option>
          <option value="true">True</option>
        </select>
      </label>
    );
  if (type === "number")
    return (
      <NumberField
        label={label}
        value={typeof value === "number" ? value : 0}
        step={0.1}
        onChange={onChange}
      />
    );
  return (
    <label>
      {label}
      <input
        value={typeof value === "string" ? value : ""}
        maxLength={120}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function ObjectField({
  label = "Scene object",
  value,
  objects,
  onChange,
}: {
  label?: string;
  value: string;
  objects: LevelObject[];
  onChange: (value: string) => void;
}) {
  const missing = !objects.some((object) => object.id === value);
  return (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {missing && (
          <option value={value}>
            {value
              ? "Missing object — choose a replacement"
              : "Place a compatible scene object first"}
          </option>
        )}
        {objects.map((object) => (
          <option key={object.id} value={object.id}>
            {objectLabel(object, objects)}
          </option>
        ))}
      </select>
    </label>
  );
}

function VariableField({
  value,
  level,
  onChange,
  numeric = false,
}: {
  value: string;
  level: LevelData;
  onChange: (variable: Variable) => void;
  numeric?: boolean;
}) {
  const variables = (level.variables ?? []).filter(
    (variable) => !numeric || variable.type === "number",
  );
  const missing = !variables.some((variable) => variable.name === value);
  return (
    <label>
      Variable
      <select
        aria-label="Variable"
        value={value}
        onChange={(event) => {
          const variable = variables.find(
            (candidate) => candidate.name === event.target.value,
          );
          if (variable) onChange(variable);
        }}
      >
        {missing && (
          <option value={value}>
            {variables.length
              ? "Missing variable — choose a replacement"
              : `Add a ${numeric ? "number " : ""}variable first`}
          </option>
        )}
        {variables.map((variable) => (
          <option key={variable.name} value={variable.name}>
            {variable.name} ({variable.type})
          </option>
        ))}
      </select>
    </label>
  );
}

const operators = {
  eq: "Equals",
  ne: "Does not equal",
  gt: "Greater than",
  gte: "At least",
  lt: "Less than",
  lte: "At most",
} as const;
function OperatorField({
  value,
  numeric = true,
  onChange,
}: {
  value: keyof typeof operators;
  numeric?: boolean;
  onChange: (value: keyof typeof operators) => void;
}) {
  return (
    <label>
      Comparison
      <select
        aria-label="Comparison"
        value={value}
        onChange={(event) => {
          if (isKey(operators, event.target.value))
            onChange(event.target.value);
        }}
      >
        {Object.entries(operators)
          .filter(([key]) => numeric || key === "eq" || key === "ne")
          .map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
      </select>
    </label>
  );
}

function IdentifierField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input
        value={value}
        maxLength={40}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        placeholder="gate_clock"
      />
    </label>
  );
}

export function EventFields({
  event,
  level,
  onChange,
}: {
  event: LogicEvent;
  level: LevelData;
  onChange: (event: LogicEvent) => void;
}) {
  const variable =
    "variable" in event
      ? level.variables?.find((candidate) => candidate.name === event.variable)
      : undefined;
  return (
    <div className={styles.fields}>
      <label>
        Event
        <select
          aria-label="Event"
          value={event.type}
          onChange={(change) => {
            if (isKey(eventLabels, change.target.value))
              onChange(defaultEvent(change.target.value, level));
          }}
        >
          {Object.entries(eventLabels).map(([type, label]) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {"objectId" in event && (
        <ObjectField
          value={event.objectId}
          objects={objectsForEvent(event.type, level)}
          onChange={(objectId) => onChange({ ...event, objectId })}
        />
      )}
      {"timer" in event && (
        <IdentifierField
          label="Timer name"
          value={event.timer}
          onChange={(timer) => onChange({ ...event, timer })}
        />
      )}
      {"variable" in event && (
        <VariableField
          level={level}
          value={event.variable}
          onChange={(variable) =>
            onChange({
              ...event,
              variable: variable.name,
              ...(event.type === "variable-reaches"
                ? { value: variable.initial }
                : {}),
            })
          }
        />
      )}
      {event.type === "variable-reaches" && (
        <ScalarField
          label="Reached value"
          value={event.value ?? variable?.initial ?? 0}
          type={variable?.type ?? "number"}
          onChange={(value) => onChange({ ...event, value })}
        />
      )}
      {event.type === "custom" && (
        <IdentifierField
          label="Event name"
          value={event.name}
          onChange={(name) => onChange({ ...event, name })}
        />
      )}
    </div>
  );
}

export function ConditionFields({
  condition,
  level,
  onChange,
  depth = 0,
}: {
  condition: LogicCondition;
  level: LevelData;
  onChange: (condition: LogicCondition) => void;
  depth?: number;
}) {
  const variable =
    condition.type === "variable"
      ? level.variables?.find(
          (candidate) => candidate.name === condition.variable,
        )
      : undefined;
  return (
    <div className={styles.condition}>
      <div className={styles.fields}>
        <label>
          Condition
          <select
            aria-label="Condition"
            value={condition.type}
            onChange={(event) => {
              if (isKey(conditionLabels, event.target.value))
                onChange(defaultCondition(event.target.value, level));
            }}
          >
            {Object.entries(conditionLabels)
              .filter(
                ([type]) => depth < 3 || (type !== "and" && type !== "or"),
              )
              .map(([type, label]) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        {condition.type === "variable" && (
          <>
            <VariableField
              level={level}
              value={condition.variable}
              onChange={(variable) =>
                onChange({
                  ...condition,
                  variable: variable.name,
                  value: variable.initial,
                  operator: "eq",
                })
              }
            />
            <OperatorField
              value={condition.operator}
              numeric={variable?.type === "number"}
              onChange={(operator) => onChange({ ...condition, operator })}
            />
            <ScalarField
              label="Compared value"
              type={variable?.type ?? "number"}
              value={condition.value}
              onChange={(value) => onChange({ ...condition, value })}
            />
          </>
        )}
        {(condition.type === "health" || condition.type === "player-count") && (
          <>
            <OperatorField
              value={condition.operator}
              onChange={(operator) => onChange({ ...condition, operator })}
            />
            <NumberField
              label={condition.type === "health" ? "Health value" : "Players"}
              value={condition.value}
              min={0}
              max={condition.type === "health" ? 100 : 4}
              onChange={(value) => onChange({ ...condition, value })}
            />
          </>
        )}
        {condition.type === "item" && (
          <>
            <IdentifierField
              label="Item name"
              value={condition.item}
              onChange={(item) => onChange({ ...condition, item })}
            />
            <NumberField
              label="Required amount"
              value={condition.count}
              min={1}
              max={999}
              onChange={(count) => onChange({ ...condition, count })}
            />
          </>
        )}
        {"objectId" in condition && (
          <>
            <ObjectField
              value={condition.objectId}
              objects={level.objects.filter((object) =>
                condition.type === "door-open"
                  ? object.type === "door"
                  : condition.type === "enemy-alive"
                    ? object.type === "enemy"
                    : true,
              )}
              onChange={(objectId) => onChange({ ...condition, objectId })}
            />
            <label>
              Required state
              <select
                aria-label="Required state"
                value={String(condition.value)}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    value: event.target.value === "true",
                  })
                }
              >
                <option value="true">
                  {condition.type === "door-open"
                    ? "Open"
                    : condition.type === "enemy-alive"
                      ? "Alive"
                      : "Active"}
                </option>
                <option value="false">
                  {condition.type === "door-open"
                    ? "Closed"
                    : condition.type === "enemy-alive"
                      ? "Defeated"
                      : "Inactive"}
                </option>
              </select>
            </label>
          </>
        )}
        {condition.type === "timer" && (
          <>
            <IdentifierField
              label="Timer name"
              value={condition.timer}
              onChange={(timer) => onChange({ ...condition, timer })}
            />
            <label>
              Timer state
              <select
                aria-label="Timer state"
                value={condition.state}
                onChange={(event) => {
                  const state = event.target.value;
                  if (
                    state === "running" ||
                    state === "expired" ||
                    state === "idle"
                  )
                    onChange({ ...condition, state });
                }}
              >
                <option value="running">Running</option>
                <option value="expired">Expired</option>
                <option value="idle">Not started</option>
              </select>
            </label>
          </>
        )}
        {condition.type === "chance" && (
          <NumberField
            label="Chance (%)"
            value={condition.percent}
            min={0}
            max={100}
            step={0.1}
            onChange={(percent) => onChange({ ...condition, percent })}
          />
        )}
      </div>
      {(condition.type === "and" || condition.type === "or") && (
        <div className={styles.nested}>
          <p>
            {condition.type === "and"
              ? "Every condition below must match."
              : "At least one condition below must match."}
          </p>
          {condition.conditions.map((child, index) => (
            <div key={index} className={styles.child}>
              <ConditionFields
                condition={child}
                level={level}
                depth={depth + 1}
                onChange={(next) =>
                  onChange({
                    ...condition,
                    conditions: condition.conditions.map((value, at) =>
                      at === index ? next : value,
                    ),
                  })
                }
              />
              <div className={styles.controls}>
                <button
                  type="button"
                  aria-label={`Move condition ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() =>
                    onChange({
                      ...condition,
                      conditions: reorder(condition.conditions, index, -1),
                    })
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move condition ${index + 1} down`}
                  disabled={index === condition.conditions.length - 1}
                  onClick={() =>
                    onChange({
                      ...condition,
                      conditions: reorder(condition.conditions, index, 1),
                    })
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={condition.conditions.length <= 1}
                  onClick={() =>
                    onChange({
                      ...condition,
                      conditions: condition.conditions.filter(
                        (_, at) => at !== index,
                      ),
                    })
                  }
                >
                  Remove condition
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={condition.conditions.length >= 8}
            onClick={() =>
              onChange({
                ...condition,
                conditions: [
                  ...condition.conditions,
                  defaultCondition("health", level),
                ],
              })
            }
          >
            + Add group condition
          </button>
        </div>
      )}
    </div>
  );
}

export function ActionFields({
  action,
  level,
  onChange,
}: {
  action: LogicAction;
  level: LevelData;
  onChange: (action: LogicAction) => void;
}) {
  const variable =
    "variable" in action
      ? level.variables?.find((candidate) => candidate.name === action.variable)
      : undefined;
  const object =
    "objectId" in action
      ? level.objects.find((candidate) => candidate.id === action.objectId)
      : undefined;
  return (
    <div className={styles.fields}>
      <label>
        Action
        <select
          aria-label="Action"
          value={action.type}
          onChange={(event) => {
            if (isKey(actionLabels, event.target.value))
              onChange(defaultAction(event.target.value, level));
          }}
        >
          {Object.entries(actionLabels).map(([type, label]) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {"objectId" in action && (
        <ObjectField
          value={action.objectId}
          objects={objectsForAction(action.type, level)}
          onChange={(objectId) => onChange({ ...action, objectId })}
        />
      )}
      {(action.type === "move" || action.type === "teleport") && (
        <>
          <NumberField
            label="Destination X"
            value={action.x}
            min={0}
            max={
              level.width - (action.type === "move" ? (object?.width ?? 8) : 20)
            }
            onChange={(x) => onChange({ ...action, x })}
          />
          <NumberField
            label="Destination Y"
            value={action.y}
            min={0}
            max={
              level.height -
              (action.type === "move" ? (object?.height ?? 8) : 28)
            }
            onChange={(y) => onChange({ ...action, y })}
          />
        </>
      )}
      {(action.type === "damage" ||
        action.type === "heal" ||
        action.type === "add-variable") && (
        <NumberField
          label={
            action.type === "add-variable"
              ? "Change amount (negative to subtract)"
              : "Amount"
          }
          value={action.amount}
          min={action.type === "add-variable" ? -10_000 : 1}
          max={action.type === "add-variable" ? 10_000 : 100}
          step={action.type === "add-variable" ? 0.1 : 1}
          onChange={(amount) => onChange({ ...action, amount })}
        />
      )}
      {(action.type === "give-item" || action.type === "remove-item") && (
        <>
          <IdentifierField
            label="Item name"
            value={action.item}
            onChange={(item) => onChange({ ...action, item })}
          />
          <NumberField
            label="Item amount"
            value={action.count}
            min={1}
            max={999}
            onChange={(count) => onChange({ ...action, count })}
          />
        </>
      )}
      {(action.type === "show-text" || action.type === "objective") && (
        <label>
          {action.type === "show-text" ? "Message" : "Objective"}
          <input
            value={action.text}
            maxLength={300}
            onChange={(event) =>
              onChange({ ...action, text: event.target.value })
            }
          />
        </label>
      )}
      {action.type === "sound" && (
        <label>
          Sound
          <select
            aria-label="Sound"
            value={action.sound}
            onChange={(event) => {
              const sound = event.target.value;
              if (sound === "beep" || sound === "success" || sound === "danger")
                onChange({ ...action, sound });
            }}
          >
            <option value="beep">Soft beep</option>
            <option value="success">Success chime</option>
            <option value="danger">Danger tone</option>
          </select>
        </label>
      )}
      {(action.type === "set-variable" || action.type === "add-variable") && (
        <VariableField
          level={level}
          value={action.variable}
          numeric={action.type === "add-variable"}
          onChange={(variable) =>
            onChange({
              ...action,
              variable: variable.name,
              ...(action.type === "set-variable"
                ? { value: variable.initial }
                : {}),
            })
          }
        />
      )}
      {action.type === "set-variable" && (
        <ScalarField
          label="New value"
          value={action.value}
          type={variable?.type ?? "number"}
          onChange={(value) => onChange({ ...action, value })}
        />
      )}
      {action.type === "set-timer" && (
        <>
          <IdentifierField
            label="Timer name"
            value={action.timer}
            onChange={(timer) => onChange({ ...action, timer })}
          />
          <NumberField
            label="Timer seconds"
            value={action.seconds}
            min={1 / 60}
            max={600}
            step={0.1}
            onChange={(seconds) => onChange({ ...action, seconds })}
          />
        </>
      )}
      {action.type === "trigger" && (
        <IdentifierField
          label="Event name"
          value={action.event}
          onChange={(event) => onChange({ ...action, event })}
        />
      )}
    </div>
  );
}
