import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface DICTClientProps {
  onBack: () => void;
}

interface DictDefinition {
  word: string;
  database: string;
  databaseDesc: string;
  text: string;
}

export default function DICTClient({ onBack }: DICTClientProps) {
  const [word, setWord] = useState('');
  const [host, setHost] = useState('dict.org');
  const [port, setPort] = useState('2628');
  const [database, setDatabase] = useState('*');
  const [strategy, setStrategy] = useState('prefix');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    word: [validationRules.required('Word is required')],
    port: [validationRules.port()],
  });

  const handleDefine = async () => {
    const isValid = validateAll({ word, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/dict/define', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host || 'dict.org',
          port: parseInt(port),
          word,
          database,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        word?: string;
        server?: string;
        banner?: string;
        definitions?: DictDefinition[];
        count?: number;
      };

      if (response.ok && data.success) {
        if (data.definitions && data.definitions.length > 0) {
          const output = [
            `DICT Define: "${data.word}"`,
            `Server: ${data.server}`,
            data.banner ? `Banner: ${data.banner}` : '',
            `${'='.repeat(60)}`,
            `${data.count} definition(s) found`,
            '',
          ].filter(Boolean).join('\n');

          const defs = data.definitions.map((def, i) => (
            `--- Definition ${i + 1} [${def.database}] ${def.databaseDesc} ---\n${def.text}`
          )).join('\n\n');

          setResult(output + defs);
        } else {
          setResult(
            `DICT Define: "${data.word}"\n` +
            `Server: ${data.server}\n` +
            `${'='.repeat(60)}\n\n` +
            `No definitions found for "${data.word}".`
          );
        }
      } else {
        setError(data.error || 'DICT lookup failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DICT lookup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMatch = async () => {
    const isValid = validateAll({ word, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/dict/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host || 'dict.org',
          port: parseInt(port),
          word,
          database,
          strategy,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        word?: string;
        server?: string;
        strategy?: string;
        matches?: { database: string; word: string }[];
        count?: number;
      };

      if (response.ok && data.success) {
        if (data.matches && data.matches.length > 0) {
          const output = [
            `DICT Match: "${data.word}" (strategy: ${data.strategy})`,
            `Server: ${data.server}`,
            `${'='.repeat(60)}`,
            `${data.count} match(es) found`,
            '',
          ].join('\n');

          const matchList = data.matches.map(
            (m) => `  [${m.database}] ${m.word}`
          ).join('\n');

          setResult(output + matchList);
        } else {
          setResult(
            `DICT Match: "${data.word}" (strategy: ${data.strategy})\n` +
            `Server: ${data.server}\n` +
            `${'='.repeat(60)}\n\n` +
            `No matches found.`
          );
        }
      } else {
        setError(data.error || 'DICT match failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DICT match failed');
    } finally {
      setLoading(false);
    }
  };

  const handleListDatabases = async () => {
    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/dict/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host || 'dict.org',
          port: parseInt(port),
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        server?: string;
        banner?: string;
        databases?: { name: string; description: string }[];
        count?: number;
      };

      if (response.ok && data.success) {
        if (data.databases && data.databases.length > 0) {
          const output = [
            `DICT Databases`,
            `Server: ${data.server}`,
            data.banner ? `Banner: ${data.banner}` : '',
            `${'='.repeat(60)}`,
            `${data.count} database(s) available`,
            '',
          ].filter(Boolean).join('\n');

          const dbList = data.databases.map(
            (db) => `  ${db.name.padEnd(20)} ${db.description}`
          ).join('\n');

          setResult(output + dbList);
        } else {
          setResult(
            `DICT Databases\n` +
            `Server: ${data.server}\n` +
            `${'='.repeat(60)}\n\n` +
            `No databases available.`
          );
        }
      } else {
        setError(data.error || 'Failed to list databases');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list databases');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && word) {
      handleDefine();
    }
  };

  const handleExampleWord = (exampleWord: string) => {
    setWord(exampleWord);
  };

  return (
    <ProtocolClientLayout title="DICT Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.DICT || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="dict-host"
            label="DICT Server"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="dict.org"
            helpText="Default: dict.org (public dictionary server)"
          />

          <FormField
            id="dict-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 2628 (standard DICT port)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Lookup" color="green" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div className="md:col-span-2">
            <FormField
              id="dict-word"
              label="Word"
              type="text"
              value={word}
              onChange={setWord}
              onKeyDown={handleKeyDown}
              placeholder="serendipity"
              required
              helpText="Enter a word to define or match"
              error={errors.word}
            />
          </div>

          <div>
            <label htmlFor="dict-database" className="block text-sm font-medium text-slate-300 mb-1">
              Database <span className="text-xs text-slate-400">(optional)</span>
            </label>
            <select
              id="dict-database"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="*">* (All Databases)</option>
              <option value="!">! (First Match)</option>
              <option value="wn">WordNet</option>
              <option value="gcide">GCIDE (GNU Collaborative Int'l Dict of English)</option>
              <option value="moby-thesaurus">Moby Thesaurus</option>
              <option value="foldoc">FOLDOC (Computing)</option>
              <option value="jargon">Jargon File (Hacker Slang)</option>
              <option value="easton">Easton's Bible Dictionary</option>
              <option value="hitchcock">Hitchcock's Bible Names</option>
              <option value="bouvier">Bouvier's Law Dictionary</option>
              <option value="devil">Devil's Dictionary (Bierce)</option>
              <option value="elements">Elements Database</option>
              <option value="vera">V.E.R.A. (Acronyms)</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">Use "List Databases" to see all available</p>
          </div>

          <div>
            <label htmlFor="dict-strategy" className="block text-sm font-medium text-slate-300 mb-1">
              Match Strategy <span className="text-xs text-slate-400">(for Match only)</span>
            </label>
            <select
              id="dict-strategy"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="prefix">Prefix</option>
              <option value="exact">Exact</option>
              <option value="substring">Substring</option>
              <option value="suffix">Suffix</option>
              <option value="re">Regex</option>
              <option value="soundex">Soundex</option>
              <option value="lev">Levenshtein</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">Strategy for finding matching words</p>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3 mb-2">
          <ActionButton
            onClick={handleDefine}
            disabled={loading || !word}
            loading={loading}
            ariaLabel="Look up word definition"
          >
            Define Word
          </ActionButton>

          <ActionButton
            onClick={handleMatch}
            disabled={loading || !word}
            loading={loading}
            variant="secondary"
            ariaLabel="Find matching words"
          >
            Match Words
          </ActionButton>

          <ActionButton
            onClick={handleListDatabases}
            disabled={loading}
            loading={loading}
            variant="secondary"
            ariaLabel="List available databases"
          >
            List Databases
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About DICT Protocol"
          description="DICT (RFC 2229) is a dictionary server protocol that provides access to multiple dictionary databases over TCP on port 2628. It supports word definitions (DEFINE), pattern matching (MATCH) with various strategies (prefix, soundex, regex, etc.), and database discovery. The public server at dict.org hosts dozens of dictionaries including WordNet, GCIDE, Moby Thesaurus, and specialty databases."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Words</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { word: 'serendipity', desc: 'Happy accident' },
              { word: 'ephemeral', desc: 'Short-lived' },
              { word: 'ubiquitous', desc: 'Everywhere' },
              { word: 'algorithm', desc: 'Computing term' },
              { word: 'petrichor', desc: 'Rain smell' },
              { word: 'sonder', desc: 'Awareness of others' },
              { word: 'defenestration', desc: 'Thrown from window' },
              { word: 'TCP', desc: 'Try in FOLDOC' },
            ].map(({ word: exampleWord, desc }) => (
              <button
                key={exampleWord}
                onClick={() => handleExampleWord(exampleWord)}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-blue-400">{exampleWord}</span>
                <span className="block text-xs text-slate-400">{desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
