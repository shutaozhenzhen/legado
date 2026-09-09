package io.legado.app.ui.book.import.local

import android.app.Application
import io.legado.app.base.BaseViewModel
import io.legado.app.constant.AppLog
import io.legado.app.constant.AppPattern.archiveFileRegex
import io.legado.app.constant.AppPattern.bookFileRegex
import io.legado.app.constant.PreferKey
import io.legado.app.data.appDb
import io.legado.app.data.entities.BookGroup
import io.legado.app.help.config.AppConfig
import io.legado.app.model.localBook.LocalBook
import io.legado.app.utils.AlphanumComparator
import io.legado.app.utils.FileDoc
import io.legado.app.utils.delete
import io.legado.app.utils.getPrefInt
import io.legado.app.utils.list
import io.legado.app.utils.mapParallel
import io.legado.app.utils.toastOnUi
import kotlinx.coroutines.Dispatchers.IO
import kotlinx.coroutines.Dispatchers.Main
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.Channel.Factory.UNLIMITED
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.consumeAsFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.withContext
import java.util.Collections

class ImportBookViewModel(application: Application) : BaseViewModel(application) {
    var rootDoc: FileDoc? = null
    val subDocs = arrayListOf<FileDoc>()
    var sort = context.getPrefInt(PreferKey.localBookImportSort)
    var dataCallback: DataCallback? = null
    var dataFlowStart: (() -> Unit)? = null
    var filterKey: String? = null
    val dataFlow = callbackFlow<List<ImportBook>> {

        val list = Collections.synchronizedList(ArrayList<ImportBook>())

        dataCallback = object : DataCallback {

            override fun setItems(fileDocs: List<FileDoc>, folderName: String?) {
                list.clear()
                fileDocs.mapTo(list) {
                    ImportBook(it, folderName)
                }
                trySend(list)
            }

            override fun addItems(fileDocs: List<FileDoc>, folderName: String?) {
                fileDocs.mapTo(list) {
                    ImportBook(it, folderName)
                }
                trySend(list)
            }

            override fun clear() {
                list.clear()
                trySend(emptyList())
            }

            override fun upAdapter() {
                trySend(list)
            }
        }

        withContext(Main) {
            dataFlowStart?.invoke()
        }

        awaitClose {
            dataCallback = null
        }

    }.map { docList ->
        val docList = docList.toList()
        val filterKey = filterKey
        val skipFilter = filterKey.isNullOrBlank()
        val comparator = when (sort) {
            2 -> compareBy<ImportBook>({ !it.isDir }, { -it.lastModified })
            1 -> compareBy({ !it.isDir }, { -it.size })
            else -> compareBy { !it.isDir }
        } then compareBy(AlphanumComparator) { it.name }
        docList.asSequence().filter {
            skipFilter || it.name.contains(filterKey)
        }.sortedWith(comparator).toList()
    }.flowOn(IO)

    fun addToBookshelf(bookList: HashSet<ImportBook>, finally: () -> Unit) {
        execute {
            val fileUris = bookList.map {
                it.file.uri
            }
            if (AppConfig.importGroupByFolder) {
                val folderOf = bookList.associate { it.file.uri to it.folderName }
                val groupCache = HashMap<String, Long>()
                LocalBook.importFiles(fileUris) { uri ->
                    val folderName = folderOf[uri]
                    if (folderName.isNullOrBlank()) {
                        0L
                    } else {
                        groupCache.getOrPut(folderName) {
                            createOrGetGroup(folderName)
                        }
                    }
                }
            } else {
                LocalBook.importFiles(fileUris)
            }
        }.onError {
            context.toastOnUi("添加书架失败，请尝试重新选择文件夹")
            AppLog.put("添加书架失败\n${it.localizedMessage}", it)
        }.onSuccess {
            context.toastOnUi("添加书架成功")
        }.onFinally {
            finally.invoke()
        }
    }

    private fun createOrGetGroup(name: String): Long {
        appDb.bookGroupDao.getByName(name)?.let {
            return it.groupId
        }
        val group = BookGroup(
            groupId = appDb.bookGroupDao.getUnusedId(),
            groupName = name,
            order = appDb.bookGroupDao.maxOrder + 1
        )
        appDb.bookGroupDao.insert(group)
        return group.groupId
    }

    fun deleteDoc(bookList: HashSet<ImportBook>, finally: () -> Unit) {
        execute {
            bookList.forEach {
                it.file.delete()
            }
        }.onFinally {
            finally.invoke()
        }
    }

    fun loadDoc(fileDoc: FileDoc) {
        execute {
            val docList = fileDoc.list { item ->
                when {
                    item.name.startsWith(".") -> false
                    item.isDir -> true
                    else -> item.name.matches(bookFileRegex) || item.name.matches(archiveFileRegex)
                }
            }
            dataCallback?.setItems(docList!!, fileDoc.name)
        }.onError {
            context.toastOnUi("获取文件列表出错\n${it.localizedMessage}")
        }
    }

    suspend fun scanDoc(fileDoc: FileDoc) {
        dataCallback?.clear()
        val channel = Channel<FileDoc>(UNLIMITED)
        var n = 1
        channel.trySend(fileDoc)
        val list = arrayListOf<FileDoc>()
        channel.consumeAsFlow()
            .mapParallel(16) { fileDoc ->
                fileDoc to fileDoc.list()!!
            }.onEach { (parentDoc, fileDocs) ->
                n--
                list.clear()
                fileDocs.forEach {
                    if (it.isDir) {
                        n++
                        channel.trySend(it)
                    } else if (it.name.matches(bookFileRegex)
                        || it.name.matches(archiveFileRegex)
                    ) {
                        list.add(it)
                    }
                }
                dataCallback?.addItems(list, parentDoc.name)
            }.takeWhile {
                n > 0
            }.catch {
                context.toastOnUi("扫描文件夹出错\n${it.localizedMessage}")
            }.collect()
    }

    fun updateCallBackFlow(filterKey: String?) {
        this.filterKey = filterKey
        dataCallback?.upAdapter()
    }

    interface DataCallback {

        fun setItems(fileDocs: List<FileDoc>, folderName: String?)

        fun addItems(fileDocs: List<FileDoc>, folderName: String?)

        fun clear()

        fun upAdapter()

    }

}