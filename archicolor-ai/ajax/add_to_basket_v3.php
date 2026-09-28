<?php
define('NO_KEEP_STATISTIC', true);
define('NOT_CHECK_PERMISSIONS', true);
require($_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php');
use Bitrix\Main\Context;use Bitrix\Main\Web\Json;use Bitrix\Main\Loader;use Bitrix\Catalog\Product\Basket as ProductBasket;
header('Content-Type: application/json; charset=UTF-8');
function out($d,$s=200){http_response_code($s);echo Json::encode($d,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
$r=Context::getCurrent()->getRequest();if(!$r->isPost())out(['status'=>'error','error'=>'method'],405);if(!check_bitrix_sessid())out(['status'=>'error','error'=>'session'],403);
if(!Loader::includeModule('catalog')||!Loader::includeModule('sale')||!Loader::includeModule('iblock'))out(['status'=>'error','error'=>'modules'],503);
$productId=(int)$r->getPost('id');$colorId=(int)$r->getPost('color_id');$qty=max(1,min(99,(int)$r->getPost('quantity')));if($productId<=0||$colorId<=0)out(['status'=>'error','error'=>'invalid_input'],400);
$color=CIBlockElement::GetList([],['IBLOCK_ID'=>49,'ID'=>$colorId,'ACTIVE'=>'Y'],false,false,['ID','NAME','CODE','PROPERTY_BACKGROUND_COLOR'])->Fetch();if(!$color)out(['status'=>'error','error'=>'color_not_found'],404);
function colorArticle($colorId,$color){
  $aliases=['ARTICLE','ARTIKUL','COLOR_CODE','COLOR_ARTICLE','CML2_ARTICLE','VENDOR_CODE'];
  $props=[];$rs=CIBlockElement::GetProperty(49,$colorId,['sort'=>'asc'],[]);
  while($pr=$rs->Fetch()){
    $code=strtoupper(trim((string)$pr['CODE']));$name=mb_strtolower(trim((string)$pr['NAME']),'UTF-8');$value=is_array($pr['VALUE'])?reset($pr['VALUE']):$pr['VALUE'];$value=trim((string)$value);
    if($value==='')continue;
    if(in_array($code,$aliases,true))return $value;
    if((mb_strpos($name,'артикул',0,'UTF-8')!==false||mb_strpos($name,'код цвета',0,'UTF-8')!==false)&&!isset($props['named']))$props['named']=$value;
  }
  if(!empty($props['named']))return $props['named'];
  $elementCode=trim((string)($color['CODE']??''));
  if($elementCode!==''&&!preg_match('/^[a-z0-9_-]+$/i',$elementCode))return $elementCode;
  return 'AP-'.str_pad((string)$colorId,5,'0',STR_PAD_LEFT);
}
$colorArticle=colorArticle($colorId,$color);
$product=CIBlockElement::GetList([],['ID'=>$productId,'ACTIVE'=>'Y'],false,false,['ID','IBLOCK_ID','NAME','PROPERTY_VOLUME','PROPERTY_CML2_LINK'])->Fetch();if(!$product||!in_array((int)$product['IBLOCK_ID'],[49,50],true))out(['status'=>'error','error'=>'product_not_found'],404);
$allowed=false;if((int)$product['IBLOCK_ID']===49){$allowed=in_array($productId,[37672,82767],true);}else{$parentId=(int)($product['PROPERTY_CML2_LINK_VALUE']??0);if($parentId>0){$parent=CIBlockElement::GetList([],['IBLOCK_ID'=>49,'ID'=>$parentId,'SECTION_ID'=>120,'ACTIVE'=>'Y'],false,false,['ID'])->Fetch();$allowed=(bool)$parent;}}if(!$allowed)out(['status'=>'error','error'=>'product_not_allowed'],403);
$props=[['NAME'=>'Цвет колеровки','CODE'=>'COLOR_NAME','VALUE'=>$color['NAME'],'SORT'=>100],['NAME'=>'Артикул цвета','CODE'=>'COLOR_ARTICLE','VALUE'=>$colorArticle,'SORT'=>105],['NAME'=>'ID Цвета','CODE'=>'COLOR_ID','VALUE'=>(string)$colorId,'SORT'=>110]];$volume=trim((string)($product['PROPERTY_VOLUME_VALUE']??''));if($volume!=='')$props[]=['NAME'=>'Литраж','CODE'=>'VOLUME','VALUE'=>$volume,'SORT'=>120];
$result=ProductBasket::addProduct(['PRODUCT_ID'=>$productId,'QUANTITY'=>$qty,'PROPS'=>$props],['LID'=>Context::getCurrent()->getSite()],['USE_MERGE'=>'N','FILL_PRODUCT_PROPERTIES'=>'Y']);
if(!$result->isSuccess())out(['status'=>'error','error'=>'basket_add_failed','messages'=>$result->getErrorMessages()],500);
$data=$result->getData();out(['status'=>'success','basket_item_id'=>(int)($data['ID']??0),'quantity'=>$qty,'color_article'=>$colorArticle]);
