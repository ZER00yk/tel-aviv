import { db } from "@tell-aviv/database";
import { publishEvent } from "../../../../apps/realtime/src/events";

/** Generate only one account's private reminders. A trusted worker can iterate account IDs. */
export async function generateSchoolReminders(userId: string) {
  const created = await db.begin(async (sql) => {
    const [user] =
      await sql`select settings,disabled from users where id=${userId} for update`;
    if (
      !user ||
      user.disabled ||
      user.settings?.notifications?.school === false
    )
      return [];
    // Ancestry makes a revoked grant or any trashed parent hide review reminders immediately.
    const rows = await sql`with recursive ancestry as (
      select r.id as resource_id,r.id,r.parent_id,r.deleted_at,r.owner_id from school_resources r where r.owner_id=${userId} or exists(select 1 from flashcard_progress p where p.resource_id=r.id and p.user_id=${userId})
      union all select a.resource_id,p.id,p.parent_id,p.deleted_at,p.owner_id from ancestry a join school_resources p on p.id=a.parent_id
    ), visible as (
      select a.resource_id from ancestry a group by a.resource_id
      having not bool_or(a.deleted_at is not null) and (bool_or(a.owner_id=${userId}) or exists(select 1 from ancestry grant_parent join school_shares s on s.resource_id=grant_parent.id where grant_parent.resource_id=a.resource_id and s.user_id=${userId}))
    ), candidates as (
      select r.id,r.class_id,r.title,case when (r.data->>'dueDate')::timestamptz<now() then 'assignment-overdue' else 'assignment-due' end as kind,r.data->>'dueDate' as cycle_key
      from school_resources r join visible v on v.resource_id=r.id
      where r.owner_id=${userId} and r.kind='assignment' and r.data->>'status'<>'done' and r.data->>'dueDate' is not null and (r.data->>'dueDate')::timestamptz<=now()+interval '24 hours'
      union all
      select r.id,r.class_id,r.title,'flashcards-due',to_char(now() at time zone 'UTC','YYYY-MM-DD')
      from school_resources r join visible v on v.resource_id=r.id
      where r.kind='flashcards' and exists(select 1 from flashcard_progress p where p.resource_id=r.id and p.user_id=${userId} and p.due_at<=now())
    ) select * from candidates c where not exists(select 1 from school_reminder_deliveries d where d.user_id=${userId} and d.resource_id=c.id and d.kind=c.kind and d.cycle_key=c.cycle_key) order by id limit 100`;
    const notifications: {
      id: string;
      kind: string;
      title: string;
      link: string;
    }[] = [];
    for (const row of rows) {
      const [cls] =
        await sql`select id from school_classes where id=${row.class_id} for update`;
      if (!cls) continue;
      const [permission] =
        await sql`with recursive ancestry as (select id,parent_id,deleted_at,owner_id from school_resources where id=${row.id} union all select p.id,p.parent_id,p.deleted_at,p.owner_id from school_resources p join ancestry a on a.parent_id=p.id) select bool_or(deleted_at is not null) as hidden,bool_or(owner_id=${userId}) or exists(select 1 from ancestry a join school_shares s on s.resource_id=a.id where s.user_id=${userId}) as allowed from ancestry`;
      if (permission?.hidden || !permission?.allowed) continue;
      const claim =
        await sql`insert into school_reminder_deliveries(user_id,resource_id,kind,cycle_key) values(${userId},${row.id},${row.kind},${row.cycle_key}) on conflict do nothing returning resource_id`;
      if (!claim.length) continue;
      const title =
        `${row.kind === "flashcards-due" ? "Cards ready to review" : row.kind === "assignment-overdue" ? "Assignment overdue" : "Assignment due soon"}: ${row.title}`.slice(
          0,
          200,
        );
      const link = `/classes?resource=${row.id}`;
      const [notification] =
        await sql`insert into notifications(user_id,kind,title,link) values(${userId},'school',${title},${link}) returning id`;
      await sql`update school_reminder_deliveries set notification_id=${notification.id} where user_id=${userId} and resource_id=${row.id} and kind=${row.kind} and cycle_key=${row.cycle_key}`;
      notifications.push({ id: notification.id, kind: "school", title, link });
    }
    return notifications;
  });
  for (const notification of created)
    await publishEvent({
      type: "notification:create",
      userIds: [userId],
      payload: notification,
    });
  return { generated: created.length };
}
