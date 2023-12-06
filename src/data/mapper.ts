import ts from "typescript";
import MSSM from "../bot.js";

export default abstract class DataMapper<TOriginal extends { id: string | number }> {
    public bot: MSSM;

    protected obj: TOriginal;

    public constructor(bot: MSSM, data: TOriginal, registry: { [key: string | number]: DataMapper<TOriginal> }) {
        this.bot = bot;
        this.obj = data;

        if (registry.hasOwnProperty(data.id)) {
            return registry[data.id];
        }

        var proxy = new Proxy(this, {
            get(target, prop) {
                if (target.obj.hasOwnProperty(prop)) {
                    return target.obj[prop as keyof typeof target.obj];
                }
                return target[prop as keyof typeof target];
            },
            set(target, prop, value) {
                if (target.obj.hasOwnProperty(prop)) {
                    target.obj[prop as keyof typeof target.obj] = value;
                    target.set(prop as keyof typeof target.obj, value);
                } else {
                    target[prop as keyof typeof target] = value;
                }
                return true;
            }
        });

        registry[data.id] = proxy;

        return proxy;
    }

    public abstract refresh(): Promise<void>;
    protected abstract set<TKey extends keyof TOriginal>(name: TKey, value: TOriginal[TKey]): void;

    protected fetchArrayFactory<T, TBase>(res: T[], data: TBase[], factory: new (bot: MSSM, data: TBase) => T) {
        res.length = 0;
        for (const i of data) {
            res.push(new factory(this.bot, i));
        }
    }
}
