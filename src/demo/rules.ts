/**
 * The rules the demo's stand-in world keeps — WRITTEN from manifest.json by
 * `npx vite-node src/demo/writeRules.ts`; do not edit by hand (`rules.test.ts`
 * fails when this and the manifest disagree). What each part means is in
 * `rulesOf.ts`.
 */
import type { DemoRules } from "./rulesOf.ts";

export const DEMO_RULES: DemoRules = {
  "decimals": {
    "rates": {
      "amount": "currency",
      "hours_per_unit": 2
    },
    "clients": {
      "tax_rate": 3
    },
    "proposals": {
      "tax_rate": 3,
      "subtotal": "currency",
      "tax": "currency",
      "total": "currency"
    },
    "proposal_lines": {
      "qty": 3,
      "rate": "currency",
      "discount": 3,
      "amount": "currency"
    },
    "milestones": {
      "estimated_days": 1
    },
    "deliverable_notes": {
      "pin_x": 4,
      "pin_y": 4
    },
    "invoices": {
      "tax_rate": 3,
      "subtotal": "currency",
      "tax": "currency",
      "total": "currency",
      "paid": "currency",
      "balance": "currency",
      "share_pct": 2,
      "client_paid_amount": "currency"
    },
    "invoice_lines": {
      "qty": 3,
      "rate": "currency",
      "discount": 3,
      "share_pct": 2,
      "amount": "currency"
    },
    "payments": {
      "amount": "currency"
    }
  },
  "states": {
    "terms_versions": {
      "column": "status",
      "initial": "draft",
      "moves": {
        "draft": [
          {
            "to": "in_force"
          }
        ],
        "in_force": [
          {
            "to": "retired"
          }
        ]
      },
      "lock": {
        "when": [
          "retired"
        ],
        "except": []
      },
      "children": {
        "terms_clauses": {
          "via": "version_id",
          "lock": true
        }
      },
      "lockedWhenReferencedBy": [
        {
          "table": "proposals",
          "via": "terms_version_id",
          "in": [
            "sent",
            "accepted",
            "declined",
            "withdrawn"
          ]
        }
      ]
    },
    "proposals": {
      "column": "status",
      "initial": "draft",
      "moves": {
        "draft": [
          {
            "to": "sent",
            "requires": {
              "children": {
                "proposal_lines": 1
              },
              "where": [
                {
                  "column": "total",
                  "gt": 0
                }
              ]
            }
          }
        ],
        "sent": [
          {
            "to": "accepted"
          },
          {
            "to": "declined"
          },
          {
            "to": "withdrawn"
          }
        ]
      },
      "lock": {
        "when": [
          "sent",
          "accepted",
          "declined",
          "withdrawn"
        ],
        "except": [
          "valid_until",
          "decided_at",
          "withdraw_reason",
          "signed_name",
          "signed_email",
          "signed_at",
          "fingerprint",
          "accepted_how",
          "decline_note",
          "new_price_asked",
          "new_price_asked_at"
        ]
      },
      "children": {
        "proposal_lines": {
          "via": "document_id",
          "lock": true
        }
      },
      "onlyLater": [
        "valid_until"
      ]
    },
    "projects": {
      "column": "status",
      "initial": "active",
      "moves": {
        "active": [
          {
            "to": "paused"
          },
          {
            "to": "done"
          }
        ],
        "paused": [
          {
            "to": "active"
          },
          {
            "to": "done"
          }
        ],
        "done": [
          {
            "to": "active",
            "roles": [
              "studio-manager"
            ]
          }
        ]
      }
    },
    "deliverables": {
      "column": "status",
      "initial": "unshared",
      "moves": {
        "unshared": [
          {
            "to": "pending"
          }
        ],
        "pending": [
          {
            "to": "approved"
          },
          {
            "to": "changes"
          },
          {
            "to": "unshared"
          }
        ],
        "changes": [
          {
            "to": "pending"
          },
          {
            "to": "approved"
          }
        ]
      }
    },
    "briefs": {
      "column": "status",
      "initial": "open",
      "moves": {
        "open": [
          {
            "to": "sent"
          }
        ]
      },
      "lock": {
        "when": [
          "sent"
        ],
        "except": []
      },
      "children": {
        "brief_answers": {
          "via": "brief_id",
          "lock": true
        }
      }
    },
    "invoices": {
      "column": "status",
      "initial": "draft",
      "moves": {
        "draft": [
          {
            "to": "sent",
            "requires": {
              "children": {
                "invoice_lines": 1
              },
              "where": [
                {
                  "column": "total",
                  "gt": 0
                }
              ]
            }
          },
          {
            "to": "void"
          }
        ],
        "sent": [
          {
            "to": "void",
            "requires": {
              "where": [
                {
                  "column": "paid",
                  "eq": 0
                }
              ]
            }
          }
        ]
      },
      "lock": {
        "when": [
          "sent",
          "void"
        ],
        "except": [
          "due_on",
          "ladder",
          "void_reason",
          "client_paid_note",
          "client_paid_amount",
          "client_paid_on",
          "client_paid",
          "client_paid_at"
        ]
      },
      "children": {
        "invoice_lines": {
          "via": "document_id",
          "lock": true
        },
        "payments": {
          "via": "document_id",
          "parentIn": [
            "sent"
          ],
          "clearOnCreate": [
            "client_paid_note",
            "client_paid_amount",
            "client_paid_on",
            "client_paid",
            "client_paid_at"
          ]
        }
      },
      "noDelete": {
        "when": "numbered"
      }
    }
  },
  "stamps": {
    "client_notes": [
      {
        "column": "by",
        "set": "user-name",
        "on": "create"
      },
      {
        "column": "at",
        "set": "now",
        "on": "create"
      }
    ],
    "enquiries": [
      {
        "column": "received_at",
        "set": "now",
        "on": "create"
      }
    ],
    "proposals": [
      {
        "column": "sent_at",
        "set": "now",
        "on": {
          "column": "status",
          "values": [
            "sent"
          ]
        }
      },
      {
        "column": "decided_at",
        "set": "now",
        "on": {
          "column": "status",
          "values": [
            "accepted",
            "declined",
            "withdrawn"
          ]
        }
      },
      {
        "column": "signed_email",
        "set": {
          "claim": "email"
        },
        "on": {
          "column": "status",
          "values": [
            "accepted"
          ]
        }
      },
      {
        "column": "signed_at",
        "set": "now",
        "on": {
          "column": "signed_name",
          "filled": true
        }
      },
      {
        "column": "fingerprint",
        "set": {
          "hashOf": {
            "columns": [
              "number",
              "title",
              "scope",
              "split",
              "currency",
              "tax_rate",
              "subtotal",
              "tax",
              "total",
              "valid_until",
              "signed_name",
              "signed_email"
            ],
            "children": [
              {
                "table": "proposal_lines",
                "via": "document_id",
                "columns": [
                  "position",
                  "description",
                  "qty",
                  "rate",
                  "discount_kind",
                  "discount",
                  "amount"
                ],
                "orderBy": "position"
              }
            ],
            "linked": [
              {
                "via": "terms_version_id",
                "table": "terms_versions",
                "columns": [
                  "version"
                ],
                "children": [
                  {
                    "table": "terms_clauses",
                    "via": "version_id",
                    "columns": [
                      "position",
                      "title",
                      "body"
                    ],
                    "orderBy": "position"
                  }
                ]
              }
            ]
          }
        },
        "on": [
          {
            "column": "status",
            "values": [
              "accepted"
            ]
          },
          {
            "column": "signed_name",
            "filled": true
          }
        ]
      },
      {
        "column": "accepted_how",
        "set": {
          "byOrigin": {
            "public": "portal"
          }
        },
        "on": {
          "column": "status",
          "values": [
            "accepted"
          ]
        }
      },
      {
        "column": "new_price_asked_at",
        "set": "now",
        "on": {
          "column": "new_price_asked",
          "values": [
            true
          ]
        }
      }
    ],
    "projects": [
      {
        "column": "started_on",
        "set": "today",
        "on": "create"
      },
      {
        "column": "done_on",
        "set": "today",
        "on": {
          "column": "status",
          "values": [
            "done"
          ]
        }
      },
      {
        "column": "share_stopped_at",
        "set": "now",
        "on": {
          "column": "share_stopped",
          "values": [
            true
          ]
        }
      },
      {
        "column": "handover_sent_at",
        "set": "now",
        "on": {
          "column": "handover_sent",
          "values": [
            true
          ]
        }
      }
    ],
    "milestones": [
      {
        "column": "done_at",
        "set": "now",
        "on": {
          "column": "state",
          "values": [
            "done"
          ]
        }
      }
    ],
    "deliverables": [
      {
        "column": "shared_at",
        "set": "now",
        "on": {
          "column": "status",
          "values": [
            "pending"
          ]
        }
      },
      {
        "column": "reviewed_at",
        "set": "now",
        "on": {
          "column": "status",
          "values": [
            "approved",
            "changes"
          ]
        }
      },
      {
        "column": "approved_how",
        "set": {
          "byOrigin": {
            "public": "portal"
          }
        },
        "on": {
          "column": "status",
          "values": [
            "approved"
          ]
        }
      },
      {
        "column": "approved_on",
        "set": {
          "byOrigin": {
            "public": "today"
          }
        },
        "on": {
          "column": "status",
          "values": [
            "approved"
          ]
        }
      },
      {
        "column": "approved_by",
        "set": {
          "claim": "contact_name",
          "staff": "user-name"
        },
        "on": {
          "column": "status",
          "values": [
            "approved"
          ]
        }
      }
    ],
    "deliverable_versions": [
      {
        "column": "posted_by",
        "set": "user-name",
        "on": "create"
      },
      {
        "column": "posted_at",
        "set": "now",
        "on": "create"
      }
    ],
    "deliverable_notes": [
      {
        "column": "side",
        "set": {
          "byOrigin": {
            "public": "client",
            "staff": "studio"
          }
        },
        "on": "create"
      },
      {
        "column": "author",
        "set": {
          "claim": "contact_name",
          "staff": "user-name"
        },
        "on": "create"
      },
      {
        "column": "at",
        "set": "now",
        "on": "create"
      }
    ],
    "briefs": [
      {
        "column": "sent_at",
        "set": "now",
        "on": {
          "column": "status",
          "values": [
            "sent"
          ]
        }
      }
    ],
    "brief_answers": [
      {
        "column": "first_answer",
        "set": {
          "copy": "answer"
        },
        "on": "create"
      }
    ],
    "invoices": [
      {
        "column": "issued_on",
        "set": "today",
        "on": {
          "column": "status",
          "values": [
            "sent"
          ]
        }
      },
      {
        "column": "due_on",
        "set": {
          "addDays": {
            "date": "issued_on",
            "days": "terms",
            "map": {
              "net7": 7,
              "net14": 14,
              "net30": 30,
              "on-receipt": 0
            }
          }
        },
        "on": {
          "column": "status",
          "values": [
            "sent"
          ]
        }
      },
      {
        "column": "sent_at",
        "set": "now",
        "on": {
          "column": "status",
          "values": [
            "sent"
          ]
        }
      },
      {
        "column": "voided_at",
        "set": "now",
        "on": {
          "column": "status",
          "values": [
            "void"
          ]
        }
      },
      {
        "column": "voided_by",
        "set": "user-name",
        "on": {
          "column": "status",
          "values": [
            "void"
          ]
        }
      },
      {
        "column": "client_paid_at",
        "set": "now",
        "on": {
          "column": "client_paid",
          "values": [
            true
          ]
        }
      }
    ],
    "payments": [
      {
        "column": "recorded_by",
        "set": "user-name",
        "on": "create"
      },
      {
        "column": "recorded_at",
        "set": "now",
        "on": "create"
      },
      {
        "column": "voided_by",
        "set": "user-name",
        "on": {
          "column": "voided",
          "values": [
            true
          ]
        }
      },
      {
        "column": "voided_at",
        "set": "now",
        "on": {
          "column": "voided",
          "values": [
            true
          ]
        }
      }
    ],
    "messages": [
      {
        "column": "created_at",
        "set": "now",
        "on": "create"
      },
      {
        "column": "approved_by",
        "set": "user-name",
        "on": {
          "column": "status",
          "values": [
            "queued"
          ]
        }
      }
    ]
  },
  "codes": {
    "projects": [
      {
        "column": "share_token",
        "length": 16
      }
    ]
  },
  "outbox": {
    "table": "messages",
    "columns": {
      "kind": "kind",
      "status": "status",
      "to": "to",
      "language": "language",
      "due": "due",
      "sentAt": "sent_at",
      "error": "error",
      "skipReason": "skip_reason",
      "subjectOverride": "subject_override",
      "bodyOverride": "body_override",
      "approvedBy": "approved_by",
      "effectAt": "effect_at",
      "effectError": "effect_error"
    },
    "links": {
      "client": "client_id",
      "proposal": "proposal_id",
      "invoice": "invoice_id",
      "payment": "payment_id",
      "project": "project_id",
      "deliverable": "deliverable_id",
      "enquiry": "enquiry_id"
    },
    "recipient": {
      "via": "client_id",
      "table": "clients",
      "email": "email",
      "name": "contact_name",
      "language": "language",
      "fallback": {
        "via": "enquiry_id",
        "email": "email",
        "name": "name"
      }
    },
    "producers": [
      {
        "kind": "proposal-sent",
        "link": "proposal_id",
        "onChange": {
          "table": "proposals",
          "column": "status",
          "to": "sent"
        }
      },
      {
        "kind": "invoice-sent",
        "link": "invoice_id",
        "onChange": {
          "table": "invoices",
          "column": "status",
          "to": "sent"
        }
      },
      {
        "kind": "invoice-rung-1",
        "link": "invoice_id",
        "onChange": {
          "table": "invoices",
          "column": "status",
          "to": "sent"
        },
        "hold": true,
        "due": {
          "date": "due_on",
          "days": {
            "setting": {
              "addOn": "invoices",
              "setting": "ladders"
            },
            "byColumn": "ladder",
            "index": 0
          },
          "at": "09:00"
        },
        "supersede": "rungs",
        "dropWhen": [
          {
            "column": "balance",
            "lte": 0,
            "reason": "paid"
          },
          {
            "column": "status",
            "eq": "void",
            "reason": "void"
          }
        ]
      },
      {
        "kind": "invoice-rung-2",
        "link": "invoice_id",
        "onChange": {
          "table": "invoices",
          "column": "status",
          "to": "sent"
        },
        "hold": true,
        "due": {
          "date": "due_on",
          "days": {
            "setting": {
              "addOn": "invoices",
              "setting": "ladders"
            },
            "byColumn": "ladder",
            "index": 1
          },
          "at": "09:00"
        },
        "supersede": "rungs",
        "dropWhen": [
          {
            "column": "balance",
            "lte": 0,
            "reason": "paid"
          },
          {
            "column": "status",
            "eq": "void",
            "reason": "void"
          }
        ]
      },
      {
        "kind": "invoice-rung-3",
        "link": "invoice_id",
        "onChange": {
          "table": "invoices",
          "column": "status",
          "to": "sent"
        },
        "hold": true,
        "due": {
          "date": "due_on",
          "days": {
            "setting": {
              "addOn": "invoices",
              "setting": "ladders"
            },
            "byColumn": "ladder",
            "index": 2
          },
          "at": "09:00"
        },
        "supersede": "rungs",
        "dropWhen": [
          {
            "column": "balance",
            "lte": 0,
            "reason": "paid"
          },
          {
            "column": "status",
            "eq": "void",
            "reason": "void"
          }
        ],
        "onSent": {
          "table": "projects",
          "via": "project_id",
          "set": {
            "status": "paused"
          }
        }
      },
      {
        "kind": "payment-receipt",
        "link": "payment_id",
        "onCreate": {
          "table": "payments"
        }
      },
      {
        "kind": "new-work",
        "link": "project_id",
        "onChange": {
          "table": "deliverables",
          "via": "project_id",
          "column": "status",
          "to": "pending"
        },
        "batchMinutes": 10
      },
      {
        "kind": "accepted-and-signed",
        "link": "proposal_id",
        "recipient": {
          "setting": {
            "table": "settings",
            "column": "reply_to"
          }
        },
        "gate": {
          "setting": {
            "table": "settings",
            "column": "notify_accepted"
          }
        },
        "onChange": {
          "table": "proposals",
          "column": "status",
          "to": "accepted"
        }
      },
      {
        "kind": "declined",
        "link": "proposal_id",
        "recipient": {
          "setting": {
            "table": "settings",
            "column": "reply_to"
          }
        },
        "gate": {
          "setting": {
            "table": "settings",
            "column": "notify_declined"
          }
        },
        "onChange": {
          "table": "proposals",
          "column": "status",
          "to": "declined"
        }
      },
      {
        "kind": "asked-for-a-new-price",
        "link": "proposal_id",
        "recipient": {
          "setting": {
            "table": "settings",
            "column": "reply_to"
          }
        },
        "gate": {
          "setting": {
            "table": "settings",
            "column": "notify_new_price"
          }
        },
        "onChange": {
          "table": "proposals",
          "column": "new_price_asked",
          "to": true
        }
      },
      {
        "kind": "changes-requested",
        "link": "deliverable_id",
        "recipient": {
          "setting": {
            "table": "settings",
            "column": "reply_to"
          }
        },
        "gate": {
          "setting": {
            "table": "settings",
            "column": "notify_files"
          }
        },
        "onChange": {
          "table": "deliverables",
          "column": "status",
          "to": "changes"
        }
      },
      {
        "kind": "approved",
        "link": "deliverable_id",
        "recipient": {
          "setting": {
            "table": "settings",
            "column": "reply_to"
          }
        },
        "gate": {
          "setting": {
            "table": "settings",
            "column": "notify_files"
          }
        },
        "onChange": {
          "table": "deliverables",
          "column": "status",
          "to": "approved",
          "where": {
            "column": "approved_how",
            "eq": "portal"
          }
        }
      },
      {
        "kind": "new-note",
        "link": "deliverable_id",
        "recipient": {
          "setting": {
            "table": "settings",
            "column": "reply_to"
          }
        },
        "gate": {
          "setting": {
            "table": "settings",
            "column": "notify_notes"
          }
        },
        "onCreate": {
          "table": "deliverable_notes",
          "via": "deliverable_id",
          "where": {
            "column": "side",
            "eq": "client"
          }
        }
      },
      {
        "kind": "client-says-paid",
        "link": "invoice_id",
        "recipient": {
          "setting": {
            "table": "settings",
            "column": "reply_to"
          }
        },
        "gate": {
          "setting": {
            "table": "settings",
            "column": "notify_paid"
          }
        },
        "onChange": {
          "table": "invoices",
          "column": "client_paid",
          "to": true
        }
      },
      {
        "kind": "brief-sent",
        "link": "project_id",
        "recipient": {
          "setting": {
            "table": "settings",
            "column": "reply_to"
          }
        },
        "gate": {
          "setting": {
            "table": "settings",
            "column": "notify_brief"
          }
        },
        "onChange": {
          "table": "briefs",
          "via": "project_id",
          "column": "status",
          "to": "sent"
        }
      }
    ]
  },
  "kinds": {
    "terms_versions": {
      "id": "int",
      "version": "int",
      "status": "enum",
      "in_force_from": "date",
      "note": "text",
      "client_key": "text"
    },
    "terms_clauses": {
      "id": "int",
      "version_id": "fk",
      "position": "int",
      "title": "text",
      "body": "text",
      "change": "enum",
      "change_note": "text",
      "client_key": "text"
    },
    "proposals": {
      "id": "int",
      "number_seq": "int",
      "number": "text",
      "status": "enum",
      "valid_until": "date",
      "currency": "text",
      "tax_name": "text",
      "tax_rate": "decimal",
      "subtotal": "decimal",
      "tax": "decimal",
      "total": "decimal",
      "sent_at": "timestamptz",
      "decided_at": "timestamptz",
      "withdraw_reason": "text",
      "client_id": "fk",
      "title": "text",
      "scope": "text",
      "split": "enum",
      "terms_version_id": "fk",
      "revision_of": "fk",
      "signed_name": "text",
      "signed_email": "text",
      "signed_at": "timestamptz",
      "fingerprint": "text",
      "accepted_how": "enum",
      "decline_note": "text",
      "new_price_asked": "bool",
      "new_price_asked_at": "timestamptz",
      "client_key": "text"
    },
    "proposal_lines": {
      "id": "int",
      "document_id": "fk",
      "position": "int",
      "description": "text",
      "qty": "decimal",
      "rate": "decimal",
      "discount_kind": "enum",
      "discount": "decimal",
      "currency": "text",
      "amount": "decimal",
      "client_id": "fk",
      "client_key": "text"
    }
  },
  "numbered": {
    "terms_versions": [
      {
        "column": "version",
        "startSetting": null
      }
    ],
    "enquiries": [
      {
        "column": "number_seq",
        "startSetting": null
      }
    ],
    "proposals": [
      {
        "column": "number_seq",
        "startSetting": "invoices.number_start_quote"
      }
    ],
    "projects": [
      {
        "column": "number_seq",
        "startSetting": null
      }
    ],
    "deliverable_versions": [
      {
        "column": "v",
        "startSetting": null
      }
    ],
    "invoices": [
      {
        "column": "number_seq",
        "startSetting": "invoices.number_start_invoice"
      }
    ],
    "payments": [
      {
        "column": "number_seq",
        "startSetting": "invoices.number_start_receipt"
      }
    ]
  },
  "capped": [
    "invoices"
  ],
  "unique": {
    "settings": [
      "singleton"
    ],
    "terms_versions": [
      "client_key"
    ],
    "terms_clauses": [
      "client_key"
    ],
    "brief_questions": [
      "key"
    ],
    "clients": [
      "email",
      "client_key"
    ],
    "enquiries": [
      "number",
      "client_key"
    ],
    "proposals": [
      "number",
      "client_key"
    ],
    "proposal_lines": [
      "client_key"
    ],
    "projects": [
      "number",
      "proposal_id",
      "share_token",
      "client_key"
    ],
    "project_fonts": [
      "client_key"
    ],
    "handover_files": [
      "client_key"
    ],
    "milestones": [
      "client_key"
    ],
    "deliverables": [
      "client_key"
    ],
    "deliverable_versions": [
      "client_key"
    ],
    "deliverable_notes": [
      "client_key"
    ],
    "briefs": [
      "project_id"
    ],
    "brief_answers": [
      "client_key"
    ],
    "invoices": [
      "number",
      "client_key"
    ],
    "invoice_lines": [
      "client_key"
    ],
    "payments": [
      "number",
      "client_key"
    ],
    "messages": [
      "client_key"
    ]
  },
  "normalize": {
    "people": [
      "email"
    ],
    "clients": [
      "email"
    ],
    "enquiries": [
      "email"
    ]
  },
  "references": {
    "terms_clauses": {
      "version_id": "terms_versions"
    },
    "client_notes": {
      "client_id": "clients"
    },
    "enquiries": {
      "client_id": "clients",
      "proposal_id": "proposals"
    },
    "proposals": {
      "client_id": "clients",
      "terms_version_id": "terms_versions",
      "revision_of": "proposals"
    },
    "proposal_lines": {
      "document_id": "proposals",
      "client_id": "clients"
    },
    "projects": {
      "client_id": "clients",
      "proposal_id": "proposals"
    },
    "project_fonts": {
      "project_id": "projects",
      "client_id": "clients"
    },
    "handover_files": {
      "project_id": "projects",
      "client_id": "clients"
    },
    "milestones": {
      "project_id": "projects",
      "client_id": "clients"
    },
    "deliverables": {
      "project_id": "projects",
      "client_id": "clients",
      "milestone_id": "milestones"
    },
    "deliverable_versions": {
      "deliverable_id": "deliverables",
      "client_id": "clients"
    },
    "deliverable_notes": {
      "deliverable_id": "deliverables",
      "client_id": "clients",
      "version_id": "deliverable_versions"
    },
    "briefs": {
      "project_id": "projects",
      "client_id": "clients"
    },
    "brief_answers": {
      "brief_id": "briefs",
      "client_id": "clients"
    },
    "invoices": {
      "from_quote_id": "proposals",
      "client_id": "clients",
      "project_id": "projects",
      "proposal_id": "proposals"
    },
    "invoice_lines": {
      "document_id": "invoices",
      "quote_id": "proposals",
      "client_id": "clients"
    },
    "payments": {
      "document_id": "invoices",
      "client_id": "clients"
    },
    "messages": {
      "client_id": "clients",
      "proposal_id": "proposals",
      "invoice_id": "invoices",
      "payment_id": "payments",
      "project_id": "projects",
      "deliverable_id": "deliverables",
      "enquiry_id": "enquiries"
    }
  }
};
