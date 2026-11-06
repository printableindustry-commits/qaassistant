import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  "thresholds": {
    "http_req_duration": [
      {
        "threshold": "p(95)<800",
        "abortOnFail": true,
        "delayAbortEval": "10s"
      },
      {
        "threshold": "p(99)<1500",
        "abortOnFail": true,
        "delayAbortEval": "10s"
      }
    ],
    "http_req_failed": [
      {
        "threshold": "rate<0.0100",
        "abortOnFail": true,
        "delayAbortEval": "10s"
      }
    ]
  },
  "tags": {
    "objective": "load",
    "env": "recette",
    "projet": "P0326"
  },
  "scenarios": {
    "default": {
      "executor": "constant-arrival-rate",
      "rate": 10,
      "timeUnit": "1s",
      "duration": "1m",
      "preAllocatedVUs": 20,
      "maxVUs": 40
    }
  }
};

const BASE_URL = __ENV.BASE_URL || 'https://u1-s0998.hpr.caas.ca-ts.group.gca';
const PATHS = ["/","/health"];
const HEALTH = '/health';
const UA = 'WizardQA-k6/1.0';

function think() {
  const min = 1;
  const max = 3;
  sleep(min + Math.random() * Math.max(0, max - min));
}

export default function () {
  const path = PATHS[Math.floor(Math.random() * PATHS.length)] || '/';
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const params = { headers: { 'User-Agent': UA, Accept: 'application/json, text/html' } };
  const res = http.get(url, params);
  check(res, {
    'status 2xx/3xx': (r) => r.status >= 200 && r.status < 400,
    'health ok': (r) => path.includes('health') ? r.status < 500 : true,
  });
  think();
}

export function setup() {
  const res = http.get(`${BASE_URL}${HEALTH}`);
  if (res.status >= 400) console.warn('Healthcheck failed:', res.status);
  return { ok: res.status < 400 };
}
