// To parse this data:
//
//   import { Convert, IndexResponse } from "./file";
//
//   const indexResponse = Convert.toIndexResponse(json);
//
// These functions will throw an error if the JSON doesn't
// match the expected interface, even if the JSON is valid.

export interface IndexResponse {
    storages: readonly string[];
    adapter:  string;
    files:    File[];
}

export interface File {
    path:           string;
    dirname:        string;
    basename:       string;
    storage:        string;
    type:           string;
    extension?:     string;
    file_size?:     number;
    bundle?:        Bundle;
    bundle_offset?: number;
    sprite?:        Sprite;
    mime_type?:     string;
}

export interface Bundle {
    name: string;
    size: number;
}

export interface Sprite {
    sheet:  string;
    source: string;
    x:      number;
    y:      number;
    w:      number;
    h:      number;
}

// Converts JSON types to/from your types
// and asserts the results at runtime
export class Convert {
    public static toIndexResponse(json: any): IndexResponse {
        return cast(json, r("IndexResponse"));
    }

    public static indexResponseToJson(value: IndexResponse): any {
        return uncast(value, r("IndexResponse"));
    }

    public static toFile(json: any): File {
        return cast(json, r("File"));
    }

    public static fileToJson(value: File): any {
        return uncast(value, r("File"));
    }

    public static toBundle(json: any): Bundle {
        return cast(json, r("Bundle"));
    }

    public static bundleToJson(value: Bundle): any {
        return uncast(value, r("Bundle"));
    }

    public static toSprite(json: any): Sprite {
        return cast(json, r("Sprite"));
    }

    public static spriteToJson(value: Sprite): any {
        return uncast(value, r("Sprite"));
    }
}

function invalidValue(typ: any, val: any, key: any, parent: any = ''): never {
    const prettyTyp = prettyTypeName(typ);
    const parentText = parent ? ` on ${parent}` : '';
    const keyText = key ? ` for key "${key}"` : '';
    throw Error(`Invalid value${keyText}${parentText}. Expected ${prettyTyp} but got ${JSON.stringify(val)}`);
}

function prettyTypeName(typ: any): string {
    if (Array.isArray(typ)) {
        if (typ.length === 2 && typ[0] === undefined) {
            return `an optional ${prettyTypeName(typ[1])}`;
        } else {
            return `one of [${typ.map(a => { return prettyTypeName(a); }).join(", ")}]`;
        }
    } else if (typeof typ === "object" && typ.literal !== undefined) {
        return typ.literal;
    } else {
        return typeof typ;
    }
}

function jsonToJSProps(typ: any): any {
    if (typ.jsonToJS === undefined) {
        const map: any = {};
        typ.props.forEach((p: any) => map[p.json] = { key: p.js, typ: p.typ });
        typ.jsonToJS = map;
    }
    return typ.jsonToJS;
}

function jsToJSONProps(typ: any): any {
    if (typ.jsToJSON === undefined) {
        const map: any = {};
        typ.props.forEach((p: any) => map[p.js] = { key: p.json, typ: p.typ });
        typ.jsToJSON = map;
    }
    return typ.jsToJSON;
}

function transform(val: any, typ: any, getProps: any, key: any = '', parent: any = ''): any {
    function transformPrimitive(typ: string, val: any): any {
        if (typeof typ === typeof val) return val;
        return invalidValue(typ, val, key, parent);
    }

    function transformUnion(typs: any[], val: any): any {
        // val must validate against one typ in typs
        const l = typs.length;
        for (let i = 0; i < l; i++) {
            const typ = typs[i];
            try {
                return transform(val, typ, getProps);
            } catch (_) {}
        }
        return invalidValue(typs, val, key, parent);
    }

    function transformEnum(cases: string[], val: any): any {
        if (cases.indexOf(val) !== -1) return val;
        return invalidValue(cases.map(a => { return l(a); }), val, key, parent);
    }

    function transformArray(typ: any, val: any): any {
        // val must be an array with no invalid elements
        if (!Array.isArray(val)) return invalidValue(l("array"), val, key, parent);
        return val.map(el => transform(el, typ, getProps));
    }

    function transformDate(val: any): any {
        if (val === null) {
            return null;
        }
        const d = new Date(val);
        if (isNaN(d.valueOf())) {
            return invalidValue(l("Date"), val, key, parent);
        }
        return d;
    }

    function transformObject(props: { [k: string]: any }, additional: any, val: any): any {
        if (val === null || typeof val !== "object" || Array.isArray(val)) {
            return invalidValue(l(ref || "object"), val, key, parent);
        }
        const result: any = {};
        Object.getOwnPropertyNames(props).forEach(key => {
            const prop = props[key];
            const v = Object.prototype.hasOwnProperty.call(val, key) ? val[key] : undefined;
            result[prop.key] = transform(v, prop.typ, getProps, key, ref);
        });
        Object.getOwnPropertyNames(val).forEach(key => {
            if (!Object.prototype.hasOwnProperty.call(props, key)) {
                result[key] = val[key];
            }
        });
        return result;
    }

    if (typ === "any") return val;
    if (typ === null) {
        if (val === null) return val;
        return invalidValue(typ, val, key, parent);
    }
    if (typ === false) return invalidValue(typ, val, key, parent);
    let ref: any = undefined;
    while (typeof typ === "object" && typ.ref !== undefined) {
        ref = typ.ref;
        typ = typeMap[typ.ref];
    }
    if (Array.isArray(typ)) return transformEnum(typ, val);
    if (typeof typ === "object") {
        return typ.hasOwnProperty("unionMembers") ? transformUnion(typ.unionMembers, val)
            : typ.hasOwnProperty("arrayItems")    ? transformArray(typ.arrayItems, val)
            : typ.hasOwnProperty("props")         ? transformObject(getProps(typ), typ.additional, val)
            : invalidValue(typ, val, key, parent);
    }
    // Numbers can be parsed by Date but shouldn't be.
    if (typ === Date && typeof val !== "number") return transformDate(val);
    return transformPrimitive(typ, val);
}

function cast<T>(val: any, typ: any): T {
    return transform(val, typ, jsonToJSProps);
}

function uncast<T>(val: T, typ: any): any {
    return transform(val, typ, jsToJSONProps);
}

function l(typ: any) {
    return { literal: typ };
}

function a(typ: any) {
    return { arrayItems: typ };
}

function u(...typs: any[]) {
    return { unionMembers: typs };
}

function o(props: any[], additional: any) {
    return { props, additional };
}

function m(additional: any) {
    return { props: [], additional };
}

function r(name: string) {
    return { ref: name };
}

const typeMap: any = {
    "IndexResponse": o([
        { json: "storages", js: "storages", typ: a("") },
        { json: "adapter", js: "adapter", typ: "" },
        { json: "files", js: "files", typ: a(r("File")) },
    ], false),
    "File": o([
        { json: "path", js: "path", typ: "" },
        { json: "dirname", js: "dirname", typ: "" },
        { json: "basename", js: "basename", typ: "" },
        { json: "storage", js: "storage", typ: "" },
        { json: "type", js: "type", typ: "" },
        { json: "extension", js: "extension", typ: u(undefined, "") },
        { json: "file_size", js: "file_size", typ: u(undefined, 0) },
        { json: "bundle", js: "bundle", typ: u(undefined, r("Bundle")) },
        { json: "bundle_offset", js: "bundle_offset", typ: u(undefined, 0) },
        { json: "sprite", js: "sprite", typ: u(undefined, r("Sprite")) },
        { json: "mime_type", js: "mime_type", typ: u(undefined, "") },
    ], false),
    "Bundle": o([
        { json: "name", js: "name", typ: "" },
        { json: "size", js: "size", typ: 0 },
    ], false),
    "Sprite": o([
        { json: "sheet", js: "sheet", typ: "" },
        { json: "source", js: "source", typ: "" },
        { json: "x", js: "x", typ: 0 },
        { json: "y", js: "y", typ: 0 },
        { json: "w", js: "w", typ: 0 },
        { json: "h", js: "h", typ: 0 },
    ], false),
};
