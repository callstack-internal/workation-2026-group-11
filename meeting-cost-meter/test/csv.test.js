import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, csvToEmployees } from '../ingest/csv.js';

const COLUMNS = {
  firstName: 'Name',
  lastName: 'Last name',
  email: 'Email',
  team: 'Team',
  roleSeniority: 'Role / Seniority Level',
  alias: 'alternatively called',
};

const HEADER = 'Name,Last name,Email,Team,Role / Seniority Level,Project,Manager,HRBP,GitHub';

test('parseCsv: quoted fields, embedded commas, escaped quotes, CRLF', () => {
  const rows = parseCsv('a,"b,c","say ""hi""",d\r\ne,f,g,h\n');
  assert.deepEqual(rows, [
    ['a', 'b,c', 'say "hi"', 'd'],
    ['e', 'f', 'g', 'h'],
  ]);
});

test('parseCsv: strips BOM and skips blank lines', () => {
  const rows = parseCsv('﻿x,y\n\n,\nz,w');
  assert.deepEqual(rows, [
    ['x', 'y'],
    ['z', 'w'],
  ]);
});

test('csvToEmployees maps the real export shape, splitting role tags', () => {
  const csv = [
    HEADER,
    'Jamie,Example,jamie.example@example.test,Technical Delivery,"Senior 1, RN Dev",Demo Project,Demo Manager,Demo HRBP,jamie-demo',
  ].join('\n');
  const [emp] = csvToEmployees(csv, COLUMNS);
  assert.equal(emp.firstName, 'Jamie');
  assert.equal(emp.lastName, 'Example');
  assert.equal(emp.email, 'jamie.example@example.test');
  assert.equal(emp.title, 'Example Jamie'); // Notion-style "Surname Name"
  assert.deepEqual(emp.teams, ['Technical Delivery']);
  assert.deepEqual(emp.roleTags, ['Senior 1', 'RN Dev']);
});

test('csvToEmployees keeps email-only rows (no name), drops empty rows', () => {
  const csv = [HEADER, ',,founder@example.test,,Founder & CTO,,,,', ',,,,,,,,'].join('\n');
  const emps = csvToEmployees(csv, COLUMNS);
  assert.equal(emps.length, 1);
  assert.equal(emps[0].email, 'founder@example.test');
  assert.deepEqual(emps[0].roleTags, ['Founder & CTO']);
});

test('csvToEmployees throws a clear error when a required column is missing', () => {
  assert.throws(() => csvToEmployees('Nope,Header\n1,2', COLUMNS), /missing the "Name" column/);
});

test('csvToEmployees reads an optional per-person contract type column', () => {
  const columns = { ...COLUMNS, contractType: 'Contract type' };
  const csv = [
    `${HEADER},Contract type`,
    'Jamie,Example,jamie.example@example.test,Technical Delivery,"Senior 1, RN Dev",Demo Project,Demo Manager,Demo HRBP,jamie-demo,CoE',
  ].join('\n');
  const [emp] = csvToEmployees(csv, columns);
  assert.equal(emp.contractType, 'CoE');
});
