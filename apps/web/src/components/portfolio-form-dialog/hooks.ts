"use client";

import { useState, useEffect } from "react";
import type {
  AccountHolder,
  AccountHolderType,
  Portfolio,
  TrConnection,
  IbkrConnection,
} from "@portfolio/api-client";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { deletePortfolioWithCleanup } from "@/lib/delete-portfolio";
import { resolveBrokerage } from "@/lib/brokerages";
import { NEW_HOLDER, type EditablePortfolio } from "./constants";
import { useFsaAllocation } from "./fsa-utils";

export function usePortfolioForm(
  mode: "create" | "edit",
  portfolio?: EditablePortfolio,
  onSuccess?: () => void,
) {
  const api = useApiClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(portfolio?.name ?? "");
  const [currency, setCurrency] = useState(portfolio?.baseCurrency ?? "IDR");
  const [holders, setHolders] = useState<AccountHolder[]>([]);
  const [accountHolderId, setAccountHolderId] = useState(portfolio?.accountHolderId ?? "");
  const [newHolderName, setNewHolderName] = useState("");
  const [newHolderType, setNewHolderType] = useState<AccountHolderType>("self");
  const [newHolderBirthYear, setNewHolderBirthYear] = useState("");
  const [brokerage, setBrokerage] = useState(portfolio?.brokerage ?? "");
  const [accountNumber, setAccountNumber] = useState(portfolio?.accountNumber ?? "");
  const [iban, setIban] = useState(portfolio?.iban ?? "");
  const [includeInAggregate, setIncludeInAggregate] = useState(
    portfolio?.includeInAggregate ?? true,
  );
  const [cashCounted, setCashCounted] = useState(portfolio?.cashCounted ?? false);
  const [allowNegativeCash, setAllowNegativeCash] = useState(portfolio?.allowNegativeCash ?? false);
  const [documentRetention, setDocumentRetention] = useState(portfolio?.documentRetention ?? false);
  const [taxAllowanceAnnual, setTaxAllowanceAnnual] = useState(portfolio?.taxAllowanceAnnual ?? "");
  const [siblingPortfolios, setSiblingPortfolios] = useState<Portfolio[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [createdPortfolio, setCreatedPortfolio] = useState<Portfolio | null>(null);
  const [trConnection, setTrConnection] = useState<TrConnection | null | false>(null);
  const [trFetchSeq, setTrFetchSeq] = useState(0);
  const [ibkrConnection, setIbkrConnection] = useState<IbkrConnection | null | false>(null);
  const [ibkrFetchSeq, setIbkrFetchSeq] = useState(0);

  const isTr = resolveBrokerage(brokerage)?.key === "trade-republic";
  const isIbkr = resolveBrokerage(brokerage)?.key === "interactive-brokers";
  const effectivePortfolio = mode === "edit" ? portfolio : createdPortfolio;
  const selectedHolder = holders.find((h) => h.id === accountHolderId) ?? null;
  const liveIsChild =
    accountHolderId === NEW_HOLDER ? newHolderType === "child" : selectedHolder?.type === "child";
  const isTrChildSaved = isTr && effectivePortfolio?.portfolioType === "child";
  const showTrChildNote = isTrChildSaved || (isTr && Boolean(liveIsChild));
  const showTrSection = effectivePortfolio != null && isTr && !isTrChildSaved;
  const showIbkrSection = effectivePortfolio != null && isIbkr;

  useEffect(() => {
    if (!open || !showTrSection) return;
    let active = true;
    api
      .getTrConnection()
      .then((conn) => {
        if (active) setTrConnection(conn);
      })
      .catch(() => {
        if (active) setTrConnection(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showTrSection, trFetchSeq]);

  useEffect(() => {
    if (!open || !showIbkrSection) return;
    let active = true;
    api
      .getIbkrConnection()
      .then((conn) => {
        if (active) setIbkrConnection(conn);
      })
      .catch(() => {
        if (active) setIbkrConnection(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showIbkrSection, ibkrFetchSeq]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    Promise.all([api.listAccountHolders(), api.listPortfolios()])
      .then(([hs, pfs]) => {
        if (active) {
          setHolders(hs);
          setSiblingPortfolios(pfs);
        }
      })
      .catch(() => {
        if (active) {
          setHolders([]);
          setSiblingPortfolios([]);
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onOpenChange(next: boolean) {
    if (next) {
      setName(portfolio?.name ?? "");
      setCurrency(portfolio?.baseCurrency ?? "IDR");
      setAccountHolderId(portfolio?.accountHolderId ?? "");
      setNewHolderName("");
      setNewHolderType("self");
      setNewHolderBirthYear("");
      setBrokerage(portfolio?.brokerage ?? "");
      setAccountNumber(portfolio?.accountNumber ?? "");
      setIban(portfolio?.iban ?? "");
      setIncludeInAggregate(portfolio?.includeInAggregate ?? true);
      setCashCounted(portfolio?.cashCounted ?? false);
      setAllowNegativeCash(portfolio?.allowNegativeCash ?? false);
      setDocumentRetention(portfolio?.documentRetention ?? false);
      setTaxAllowanceAnnual(portfolio?.taxAllowanceAnnual ?? "");
      setSiblingPortfolios([]);
      setError(false);
      setConfirmDelete(false);
      setCreatedPortfolio(null);
      setTrConnection(null);
      setTrFetchSeq(0);
      setIbkrConnection(null);
      setIbkrFetchSeq(0);
    }
    setOpen(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    if (accountHolderId === NEW_HOLDER && !newHolderName.trim()) return;
    setBusy(true);
    setError(false);
    try {
      let holderId: string | null = accountHolderId || null;
      if (accountHolderId === NEW_HOLDER) {
        const by =
          newHolderType === "child" && newHolderBirthYear.trim() !== ""
            ? Number(newHolderBirthYear)
            : null;
        const createdHolder = await api.createAccountHolder({
          name: newHolderName.trim(),
          type: newHolderType,
          birthYear: by,
        });
        holderId = createdHolder.id;
        setHolders((prev) => [...prev, createdHolder]);
        setAccountHolderId(createdHolder.id);
      }
      const fsaTrimmed = taxAllowanceAnnual.trim();
      const input = {
        name: trimmed,
        baseCurrency: currency,
        accountHolderId: holderId,
        brokerage: brokerage.trim() || null,
        accountNumber: accountNumber.trim() || null,
        iban: iban.trim() || null,
        includeInAggregate,
        cashCounted,
        allowNegativeCash,
        documentRetention,
        taxAllowanceAnnual: fsaTrimmed !== "" ? fsaTrimmed : null,
      };
      if (mode === "edit" && portfolio) {
        await api.updatePortfolio(portfolio.id, input);
        router.refresh();
        onSuccess?.();
        setOpen(false);
      } else {
        const created = await api.createPortfolio(input);
        router.refresh();
        onSuccess?.();
        if ((isTr && created.portfolioType !== "child") || isIbkr) {
          setCreatedPortfolio(created);
        } else {
          setOpen(false);
        }
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!portfolio) return;
    setBusy(true);
    try {
      await deletePortfolioWithCleanup(api, router, portfolio.id);
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const {
    selectedHolderObj,
    holderAllowanceCap,
    totalAllocated,
    fsaRemainingForHolder,
    fsaOverAllocated,
    showFsaHelper,
  } = useFsaAllocation(
    accountHolderId,
    taxAllowanceAnnual,
    holders,
    siblingPortfolios,
    portfolio?.id,
  );

  const boundElsewhere =
    trConnection !== null &&
    trConnection !== false &&
    effectivePortfolio != null &&
    trConnection.status !== "disconnected" &&
    trConnection.portfolioId !== null &&
    trConnection.portfolioId !== effectivePortfolio.id;

  const trInitForFlow: TrConnection | null = !trConnection
    ? null
    : boundElsewhere
      ? { ...trConnection, status: "disconnected", portfolioId: null }
      : trConnection;

  return {
    api,
    router,
    open,
    setOpen,
    name,
    setName,
    currency,
    setCurrency,
    holders,
    setHolders,
    accountHolderId,
    setAccountHolderId,
    newHolderName,
    setNewHolderName,
    newHolderType,
    setNewHolderType,
    newHolderBirthYear,
    setNewHolderBirthYear,
    brokerage,
    setBrokerage,
    accountNumber,
    setAccountNumber,
    iban,
    setIban,
    includeInAggregate,
    setIncludeInAggregate,
    cashCounted,
    setCashCounted,
    allowNegativeCash,
    setAllowNegativeCash,
    documentRetention,
    setDocumentRetention,
    taxAllowanceAnnual,
    setTaxAllowanceAnnual,
    siblingPortfolios,
    busy,
    error,
    confirmDelete,
    setConfirmDelete,
    createdPortfolio,
    trConnection,
    trFetchSeq,
    setTrFetchSeq,
    ibkrConnection,
    ibkrFetchSeq,
    setIbkrFetchSeq,
    isTr,
    isIbkr,
    effectivePortfolio,
    selectedHolder,
    liveIsChild,
    isTrChildSaved,
    showTrChildNote,
    showTrSection,
    showIbkrSection,
    boundElsewhere,
    trInitForFlow,
    onOpenChange,
    submit,
    onDelete,
    selectedHolderObj,
    holderAllowanceCap,
    totalAllocated,
    fsaRemainingForHolder,
    fsaOverAllocated,
    showFsaHelper,
  };
}
