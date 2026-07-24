// Notion access via the official @notionhq/client SDK.
//
// Two things are read:
//   1. The "Current Employees" database -> one record per employee.
//   2. The "Salary ranges" page's child blocks -> signed download URLs for the
//      two salary PDFs.
//
// We use `databases.query` (stable across SDK/notionVersion) rather than the
// newer data-source API — the employee DB is single-source, so this is simpler
// and more robust. If Callstack later makes it multi-source, switch to
// `notion.dataSources.query({ data_source_id })` with notionVersion 2025-09-03.

import { Client } from '@notionhq/client';

export function createClient() {
  const auth = process.env.NOTION_TOKEN;
  if (!auth) {
    throw new Error('NOTION_TOKEN is not set. Copy .env.example to .env and add your token.');
  }
  return new Client({ auth });
}

function plainText(rich) {
  return (rich || []).map((r) => r.plain_text).join('').trim();
}

function multiSelect(prop) {
  return (prop?.multi_select || []).map((o) => o.name);
}

/** Map one Notion page (DB row) to a flat employee record using config.properties. */
export function mapEmployee(page, props) {
  const p = page.properties || {};
  const firstName = plainText(p[props.firstName]?.rich_text);
  const lastName = plainText(p[props.lastName]?.rich_text);
  const title = plainText(p[props.title]?.title);
  const email = p[props.email]?.email || '';
  const alias = plainText(p[props.alias]?.rich_text);
  const teams = multiSelect(p[props.team]);
  const roleTags = multiSelect(p[props.roleSeniority]);

  if (!firstName && !lastName && !title && !email) return null; // empty/placeholder row

  return {
    firstName,
    lastName,
    title,
    email,
    aliases: alias ? [alias] : [],
    teams,
    roleTags,
  };
}

/** Fetch every employee, following pagination. */
export async function fetchEmployees(notion, databaseId, props) {
  const employees = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const emp = mapEmployee(page, props);
      if (emp) employees.push(emp);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return employees;
}

/**
 * Return the salary PDF attachments on the page as
 * `[{ url, section, filename }]`. `url` is a short-lived signed S3 link
 * (~1h) — download it immediately, never cache it.
 */
export async function fetchSalaryPdfLinks(notion, pageId) {
  const pdfs = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of res.results) {
      if (block.type !== 'pdf' && block.type !== 'file') continue;
      const f = block[block.type];
      const url = f?.type === 'external' ? f.external?.url : f?.file?.url;
      if (!url) continue;
      const filename = decodeURIComponent(url.split('?')[0].split('/').pop() || '');
      const section = /business/i.test(url) || /business/i.test(filename) ? 'business' : 'delivery';
      pdfs.push({ url, section, filename });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pdfs;
}
