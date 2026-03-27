/**
 * Slack Incoming Webhook 通知ユーティリティ
 */

const WEBHOOK_MATERIALS = process.env.SLACK_WEBHOOK_MATERIALS;

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: { type: string; text: string }[];
  elements?: { type: string; text: string }[];
}

async function sendWebhook(webhookUrl: string, blocks: SlackBlock[], text: string): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
    });
    if (!res.ok) {
      console.error('[slack] Webhook送信失敗:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('[slack] Webhook送信エラー:', e);
    return false;
  }
}

// ============================================
// 教材発注通知
// ============================================

interface OrderNotificationParams {
  schoolName: string;
  materialName: string;
  studentName: string;
  quantity: number;
}

/** 発注通知（未確認 → 発注済み） */
export async function notifyOrderPlaced(params: OrderNotificationParams): Promise<boolean> {
  if (!WEBHOOK_MATERIALS) return false;

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📦 教材を発注しました', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*教室:*\n${params.schoolName}` },
        { type: 'mrkdwn', text: `*教材:*\n${params.materialName}` },
        { type: 'mrkdwn', text: `*生徒:*\n${params.studentName}` },
        { type: 'mrkdwn', text: `*数量:*\n${params.quantity}` },
      ],
    },
  ];

  return sendWebhook(WEBHOOK_MATERIALS, blocks, `📦 発注: ${params.materialName}（${params.studentName}）`);
}

/** 発送通知（発注済み → 発送済み） */
export async function notifyOrderDelivered(params: OrderNotificationParams): Promise<boolean> {
  if (!WEBHOOK_MATERIALS) return false;

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🚚 教材が発送されました', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*教室:*\n${params.schoolName}` },
        { type: 'mrkdwn', text: `*教材:*\n${params.materialName}` },
        { type: 'mrkdwn', text: `*生徒:*\n${params.studentName}` },
        { type: 'mrkdwn', text: `*数量:*\n${params.quantity}` },
      ],
    },
  ];

  return sendWebhook(WEBHOOK_MATERIALS, blocks, `🚚 発送: ${params.materialName}（${params.studentName}）`);
}

/** 一括発注通知 */
export async function notifyBulkOrderPlaced(params: {
  schoolName: string;
  orderCount: number;
  items: { materialName: string; studentName: string; quantity: number }[];
}): Promise<boolean> {
  if (!WEBHOOK_MATERIALS) return false;

  const itemLines = params.items.slice(0, 10).map(
    (item) => `• ${item.materialName} → ${item.studentName}（${item.quantity}冊）`
  );
  if (params.items.length > 10) {
    itemLines.push(`…他 ${params.items.length - 10} 件`);
  }

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📦 ${params.orderCount}件の教材を一括発注しました`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*教室:* ${params.schoolName}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: itemLines.join('\n') },
    },
  ];

  return sendWebhook(WEBHOOK_MATERIALS, blocks, `📦 一括発注: ${params.orderCount}件（${params.schoolName}）`);
}

/** 一括発送通知 */
export async function notifyBulkOrderDelivered(params: {
  schoolName: string;
  orderCount: number;
  items: { materialName: string; studentName: string; quantity: number }[];
}): Promise<boolean> {
  if (!WEBHOOK_MATERIALS) return false;

  const itemLines = params.items.slice(0, 10).map(
    (item) => `• ${item.materialName} → ${item.studentName}（${item.quantity}冊）`
  );
  if (params.items.length > 10) {
    itemLines.push(`…他 ${params.items.length - 10} 件`);
  }

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🚚 ${params.orderCount}件の教材が発送されました`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*教室:* ${params.schoolName}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: itemLines.join('\n') },
    },
  ];

  return sendWebhook(WEBHOOK_MATERIALS, blocks, `🚚 一括発送: ${params.orderCount}件（${params.schoolName}）`);
}

/** 未確認リマインダー */
export async function notifyUnconfirmedReminder(params: {
  orders: { schoolName: string; materialName: string; studentName: string; createdAt: string }[];
}): Promise<boolean> {
  if (!WEBHOOK_MATERIALS) return false;

  const itemLines = params.orders.slice(0, 15).map(
    (o) => `• ${o.schoolName} | ${o.materialName} → ${o.studentName}（${o.createdAt}）`
  );
  if (params.orders.length > 15) {
    itemLines.push(`…他 ${params.orders.length - 15} 件`);
  }

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `⚠️ 未確認の発注が ${params.orders.length} 件あります`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: itemLines.join('\n') },
    },
  ];

  return sendWebhook(WEBHOOK_MATERIALS, blocks, `⚠️ 未確認の発注: ${params.orders.length}件`);
}

/** 配布遅延リマインダー（発送後7日以上） */
export async function notifyDistributionReminder(params: {
  orders: { schoolName: string; materialName: string; studentName: string; deliveredAt: string }[];
}): Promise<boolean> {
  if (!WEBHOOK_MATERIALS) return false;

  const itemLines = params.orders.slice(0, 15).map(
    (o) => `• ${o.schoolName} | ${o.materialName} → ${o.studentName}（発送: ${o.deliveredAt}）`
  );
  if (params.orders.length > 15) {
    itemLines.push(`…他 ${params.orders.length - 15} 件`);
  }

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `⚠️ 発送後7日以上未配布の教材が ${params.orders.length} 件あります`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: itemLines.join('\n') },
    },
  ];

  return sendWebhook(WEBHOOK_MATERIALS, blocks, `⚠️ 未配布の教材: ${params.orders.length}件`);
}

// ============================================
// デイリーレポート（平日13時）
// ============================================

interface DailyReportSchoolSection {
  schoolName: string;
  slackMentionId: string | null;
  unconfirmed: { materialName: string; studentName: string; createdAt: string }[];
  overdueDistribution: { materialName: string; studentName: string; deliveredAt: string }[];
}

/** 教材管理デイリーレポート */
export async function notifyDailyReport(params: {
  date: string; // "3/27" 形式
  schools: DailyReportSchoolSection[];
}): Promise<boolean> {
  if (!WEBHOOK_MATERIALS) return false;

  // 全体の件数
  const totalUnconfirmed = params.schools.reduce((sum, s) => sum + s.unconfirmed.length, 0);
  const totalOverdue = params.schools.reduce((sum, s) => sum + s.overdueDistribution.length, 0);

  if (totalUnconfirmed === 0 && totalOverdue === 0) {
    // 何もなければ通知しない
    return true;
  }

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 教材管理デイリーレポート（${params.date}）`, emoji: true },
    },
  ];

  // 未確認セクション
  if (totalUnconfirmed > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🔴 未確認の発注: ${totalUnconfirmed}件*` },
    });

    for (const school of params.schools) {
      if (school.unconfirmed.length === 0) continue;
      const mention = school.slackMentionId ? ` <@${school.slackMentionId}>` : '';
      const lines = school.unconfirmed.slice(0, 10).map(
        (o) => `　• ${o.materialName} → ${o.studentName}（${o.createdAt}）`
      );
      if (school.unconfirmed.length > 10) {
        lines.push(`　…他 ${school.unconfirmed.length - 10} 件`);
      }
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${school.schoolName}*${mention}\n${lines.join('\n')}` },
      });
    }
  }

  // 配布遅延セクション
  if (totalOverdue > 0) {
    blocks.push(
      { type: 'divider' } as SlackBlock,
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*🟡 発送後7日以上未配布: ${totalOverdue}件*` },
      }
    );

    for (const school of params.schools) {
      if (school.overdueDistribution.length === 0) continue;
      const mention = school.slackMentionId ? ` <@${school.slackMentionId}>` : '';
      const lines = school.overdueDistribution.slice(0, 10).map(
        (o) => `　• ${o.materialName} → ${o.studentName}（発送: ${o.deliveredAt}）`
      );
      if (school.overdueDistribution.length > 10) {
        lines.push(`　…他 ${school.overdueDistribution.length - 10} 件`);
      }
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${school.schoolName}*${mention}\n${lines.join('\n')}` },
      });
    }
  }

  return sendWebhook(
    WEBHOOK_MATERIALS,
    blocks,
    `📋 デイリーレポート: 未確認${totalUnconfirmed}件 / 未配布${totalOverdue}件`
  );
}
